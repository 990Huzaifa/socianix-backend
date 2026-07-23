import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createCipheriv, randomBytes } from 'crypto';
import FormData from 'form-data';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SnapchatPostType } from '../posts/dto/create-post.dto';
import { SocialAccountsService } from './social-accounts.service';

const MARKETING_API_BASE = 'https://businessapi.snapchat.com';
const MULTIPART_CHUNK_SIZE = 32 * 1024 * 1024; // 32MB

export type CreateSnapchatPostInput = {
  postType: SnapchatPostType;
  /** Public Profile UUID. Resolved via /my_profile when omitted. */
  profileId?: string | null;
  title?: string | null;
  description?: string | null;
  /** Public media URL (S3). Spotlight requires video. */
  mediaUrl: string;
  mediaType: 'IMAGE' | 'VIDEO';
  locale?: string | null;
};

@Injectable()
export class SnapchatService {
  private readonly logger = new Logger(SnapchatService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  getClientId(): string {
    return this.configService.getOrThrow<string>('SNAPCHAT_CLIENT_ID');
  }

  getClientSecret(): string {
    return this.configService.getOrThrow<string>('SNAPCHAT_CLIENT_SECRET');
  }

  getRedirectUri(): string {
    return (
      this.configService.get<string>('SNAPCHAT_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/snapchat/callback`
    );
  }

  getScopes(): string[] {
    // Public Profile API requires snapchat-profile-api (see Get Started docs).
    const raw =
      this.configService.get<string>('SNAPCHAT_SCOPES') ??
      'snapchat-profile-api snapchat-marketing-api';

    return raw.split(/[\s,]+/).filter(Boolean);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.getClientId(),
      redirect_uri: this.getRedirectUri(),
      response_type: 'code',
      scope: this.getScopes().join(' '),
      state,
    });

    return `https://accounts.snapchat.com/login/oauth2/authorize?${params.toString()}`;
  }

  async getAccessToken(code: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.getRedirectUri(),
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://accounts.snapchat.com/login/oauth2/access_token',
          body.toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
          },
        ),
      );

      return this.mapTokenResponse(data as Record<string, unknown>);
    } catch (error) {
      this.logger.error(
        `Snapchat token exchange failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException(
        'Failed to exchange Snapchat authorization code',
      );
    }
  }

  /**
   * After OAuth, access_token → my_profile (profile id) → public profile data.
   * GET /public/v1/public_profiles/{PROFILE_ID}
   */
  async getUserProfile(accessToken: string, profileId?: string | null) {
    const resolvedProfileId =
      profileId?.trim() || (await this.resolveMyProfileId(accessToken));

    const publicProfile = await this.getPublicProfileById(
      accessToken,
      resolvedProfileId,
    );

    return this.mapPublicProfile(publicProfile);
  }

  /**
   * GET https://businessapi.snapchat.com/public/v1/public_profiles/{PROFILE_ID}
   */
  async getPublicProfileById(accessToken: string, profileId: string) {
    const id = profileId?.trim();
    if (!id) {
      throw new BadRequestException('Snapchat profile id is required');
    }
    const url = `${MARKETING_API_BASE}/public/v1/public_profiles/${encodeURIComponent(id)}`;
    console.log('url', url);
    const data = await this.requestJson(
      'GET',
      url,
      accessToken,
    );

    this.assertSnapSuccess(data, 'Failed to fetch Snapchat Public Profile');

    const entries = data.public_profiles as
      | Array<{
          sub_request_status?: string;
          public_profile?: Record<string, unknown>;
          sub_request_error_reason?: string;
        }>
      | undefined;

    const entry = entries?.[0];
    const subStatus = String(entry?.sub_request_status ?? '').toUpperCase();
    if (subStatus && subStatus !== 'SUCCESS') {
      throw new BadRequestException(
        entry?.sub_request_error_reason?.trim() ||
          'Failed to fetch Snapchat Public Profile',
      );
    }

    const publicProfile = entry?.public_profile;
    if (!publicProfile || typeof publicProfile.id !== 'string') {
      throw new BadRequestException(
        `Snapchat Public Profile "${id}" was not found`,
      );
    }

    return publicProfile;
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);
    const publicProfile = profile.raw as Record<string, unknown>;

    return {
      profile,
      metadata: {
        provider: 'snapchat',
        products: ['snapchat'],
        providerProfile: publicProfile,
        publicProfile,
        publicProfileId:
          typeof publicProfile?.id === 'string' ? publicProfile.id : null,
        organizationId:
          typeof publicProfile?.organization_id === 'string'
            ? publicProfile.organization_id
            : null,
      },
    };
  }

  /**
   * Upload media to a Public Profile, then post as Story / Spotlight / Saved Story.
   */
  async createPost(accessToken: string, input: CreateSnapchatPostInput) {
    const mediaUrl = input.mediaUrl?.trim();
    if (!mediaUrl) {
      throw new BadRequestException('Snapchat post requires a mediaUrl');
    }

    if (input.postType === 'SPOTLIGHT' && input.mediaType !== 'VIDEO') {
      throw new BadRequestException(
        'Snapchat Spotlight posts require a video file',
      );
    }

    const profileId = await this.resolveProfileId(
      accessToken,
      input.profileId,
    );

    const mediaBuffer = await this.downloadMedia(mediaUrl);
    const mediaId = await this.uploadEncryptedMedia(
      accessToken,
      profileId,
      mediaBuffer,
      input.mediaType,
      `socianix-${Date.now()}`,
    );

    if (input.postType === 'PUBLIC_STORY') {
      const result = await this.postPublicStory(
        accessToken,
        profileId,
        mediaId,
      );
      return {
        kind: 'PUBLIC_STORY' as const,
        profileId,
        mediaId,
        ...result,
      };
    }

    if (input.postType === 'SPOTLIGHT') {
      const locale =
        input.locale?.trim() ||
        this.configService.get<string>('SNAPCHAT_DEFAULT_LOCALE') ||
        'en_US';
      const description = (
        input.description?.trim() ||
        input.title?.trim() ||
        ''
      ).slice(0, 160);

      const result = await this.postSpotlight(accessToken, profileId, {
        mediaId,
        description: description || undefined,
        locale,
      });
      return {
        kind: 'SPOTLIGHT' as const,
        profileId,
        mediaId,
        ...result,
      };
    }

    const title = (
      input.title?.trim() ||
      input.description?.trim() ||
      'Saved Story'
    ).slice(0, 45);

    const result = await this.postSavedStory(accessToken, profileId, {
      mediaId,
      title,
    });
    return {
      kind: 'SAVED_STORY' as const,
      profileId,
      mediaId,
      ...result,
    };
  }

  async createPostForUser(userId: string, input: CreateSnapchatPostInput) {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'snapchat',
      );
    const accessToken =
      this.socialAccountsService.assertHasAccessToken(account);

    const profileIdFromAccount = this.pickProfileIdFromMetadata(
      account.metadata,
    );

    return this.createPost(accessToken, {
      ...input,
      profileId: input.profileId?.trim() || profileIdFromAccount,
    });
  }

  /**
   * Authorized endpoint used only to discover the caller's profile id.
   * GET /v1/public_profiles/my_profile
   */
  async resolveMyProfileId(accessToken: string): Promise<string> {
    const data = await this.requestJson(
      'GET',
      `${MARKETING_API_BASE}/v1/public_profiles/my_profile`,
      accessToken,
    );

    this.assertSnapSuccess(
      data,
      'Failed to resolve Snapchat Public Profile id',
    );

    const profile =
      (data.public_profile as Record<string, unknown> | undefined) ??
      (
        data.public_profiles as
          | Array<{ public_profile?: Record<string, unknown> }>
          | undefined
      )?.[0]?.public_profile;

    if (!profile || typeof profile.id !== 'string') {
      throw new BadRequestException(
        'No Snapchat Public Profile found for this account. Ensure the user has a Public Profile and the token includes snapchat-profile-api.',
      );
    }

    return profile.id;
  }

  private mapPublicProfile(publicProfile: Record<string, unknown>) {
    const logoUrls = (publicProfile.logo_urls ?? null) as
      | Record<string, unknown>
      | null;

    const displayName =
      typeof publicProfile.display_name === 'string'
        ? publicProfile.display_name
        : null;
    const username =
      typeof publicProfile.snap_user_name === 'string'
        ? publicProfile.snap_user_name
        : (displayName ?? String(publicProfile.id));

    const profileImage =
      (typeof logoUrls?.manage_profile_logo_url === 'string' &&
        logoUrls.manage_profile_logo_url) ||
      (typeof logoUrls?.original_logo_url === 'string' &&
        logoUrls.original_logo_url) ||
      (typeof logoUrls?.mega_profile_logo_url === 'string' &&
        logoUrls.mega_profile_logo_url) ||
      (typeof logoUrls?.discover_feed_logo_url === 'string' &&
        logoUrls.discover_feed_logo_url) ||
      null;

    return {
      platformUserId: String(publicProfile.id),
      username,
      displayName,
      profileImage,
      email:
        typeof publicProfile.email === 'string' ? publicProfile.email : null,
      raw: publicProfile,
    };
  }

  private async resolveProfileId(
    accessToken: string,
    profileId?: string | null,
  ): Promise<string> {
    const provided = profileId?.trim();
    if (provided) {
      return provided;
    }

    return this.resolveMyProfileId(accessToken);
  }

  private pickProfileIdFromMetadata(
    metadata: Record<string, unknown> | null | undefined,
  ): string | null {
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }
    if (typeof metadata.publicProfileId === 'string') {
      return metadata.publicProfileId;
    }
    const nested = metadata.publicProfile;
    if (
      nested &&
      typeof nested === 'object' &&
      typeof (nested as { id?: unknown }).id === 'string'
    ) {
      return (nested as { id: string }).id;
    }
    return null;
  }

  private async downloadMedia(url: string): Promise<Buffer> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'arraybuffer',
          timeout: 120000,
        }),
      );
      return Buffer.from(data);
    } catch (error) {
      this.logger.error(
        `Snapchat media download failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException('Failed to download media for Snapchat');
    }
  }

  private encryptMedia(buffer: Buffer): {
    encrypted: Buffer;
    keyBase64: string;
    ivBase64: string;
  } {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return {
      encrypted,
      keyBase64: key.toString('base64'),
      ivBase64: iv.toString('base64'),
    };
  }

  private async uploadEncryptedMedia(
    accessToken: string,
    profileId: string,
    mediaBuffer: Buffer,
    mediaType: 'IMAGE' | 'VIDEO',
    name: string,
  ): Promise<string> {
    const { encrypted, keyBase64, ivBase64 } = this.encryptMedia(mediaBuffer);

    const createData = await this.requestJson(
      'POST',
      `${MARKETING_API_BASE}/v1/public_profiles/${encodeURIComponent(profileId)}/media`,
      accessToken,
      {
        type: mediaType,
        name,
        key: keyBase64,
        iv: ivBase64,
      },
    );

    this.assertSnapSuccess(createData, 'Failed to create Snapchat media');

    const mediaId = createData.media_id;
    const addPath = createData.add_path;
    const finalizePath = createData.finalize_path;

    if (typeof mediaId !== 'string' || !mediaId) {
      throw new BadRequestException('Snapchat media create did not return media_id');
    }
    if (typeof addPath !== 'string' || typeof finalizePath !== 'string') {
      throw new BadRequestException(
        'Snapchat media create did not return upload paths',
      );
    }

    const chunks = this.splitBuffer(encrypted, MULTIPART_CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i += 1) {
      await this.uploadMediaPart(
        accessToken,
        addPath,
        chunks[i],
        i + 1,
      );
    }

    await this.finalizeMediaUpload(accessToken, finalizePath);

    this.logger.log(
      `Uploaded Snapchat media profileId=${profileId} mediaId=${mediaId} parts=${chunks.length}`,
    );

    return mediaId;
  }

  private splitBuffer(buffer: Buffer, chunkSize: number): Buffer[] {
    if (buffer.length <= chunkSize) {
      return [buffer];
    }
    const parts: Buffer[] = [];
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      parts.push(buffer.subarray(offset, offset + chunkSize));
    }
    return parts;
  }

  private async uploadMediaPart(
    accessToken: string,
    addPath: string,
    part: Buffer,
    partNumber: number,
  ) {
    const form = new FormData();
    form.append('action', 'ADD');
    form.append('part_number', String(partNumber));
    form.append('file', part, {
      filename: `part-${partNumber}.bin`,
      contentType: 'application/octet-stream',
    });

    const data = await this.requestMultipart(
      `${MARKETING_API_BASE}${addPath.startsWith('/') ? addPath : `/${addPath}`}`,
      accessToken,
      form,
    );
    this.assertSnapSuccess(data, `Failed to upload Snapchat media part ${partNumber}`);
  }

  private async finalizeMediaUpload(accessToken: string, finalizePath: string) {
    const form = new FormData();
    form.append('action', 'FINALIZE');

    const data = await this.requestMultipart(
      `${MARKETING_API_BASE}${finalizePath.startsWith('/') ? finalizePath : `/${finalizePath}`}`,
      accessToken,
      form,
    );
    this.assertSnapSuccess(data, 'Failed to finalize Snapchat media upload');
  }

  private async postPublicStory(
    accessToken: string,
    profileId: string,
    mediaId: string,
  ) {
    const data = await this.requestJson(
      'POST',
      `${MARKETING_API_BASE}/v1/public_profiles/${encodeURIComponent(profileId)}/stories`,
      accessToken,
      { media_id: mediaId },
    );
    this.assertSnapSuccess(data, 'Failed to post Snapchat Public Story');
    return {
      requestId: data.request_id ?? null,
      raw: data,
      postId: typeof data.story_id === 'string' ? data.story_id : mediaId,
    };
  }

  private async postSpotlight(
    accessToken: string,
    profileId: string,
    input: { mediaId: string; description?: string; locale: string },
  ) {
    const body: Record<string, unknown> = {
      media_id: input.mediaId,
      locale: input.locale,
      skip_save_to_profile: false,
    };
    if (input.description) {
      body.description = input.description;
    }

    const data = await this.requestJson(
      'POST',
      `${MARKETING_API_BASE}/v1/public_profiles/${encodeURIComponent(profileId)}/spotlights`,
      accessToken,
      body,
    );
    this.assertSnapSuccess(data, 'Failed to post Snapchat Spotlight');

    const spotlightId =
      typeof data.spotlight_id === 'string' ? data.spotlight_id : null;

    return {
      requestId: data.request_id ?? null,
      spotlightId,
      postId: spotlightId,
      raw: data,
    };
  }

  private async postSavedStory(
    accessToken: string,
    profileId: string,
    input: { mediaId: string; title: string },
  ) {
    const data = await this.requestJson(
      'POST',
      `${MARKETING_API_BASE}/v1/public_profiles/${encodeURIComponent(profileId)}/saved_stories`,
      accessToken,
      {
        saved_stories: [
          {
            title: input.title,
            snap_sources: [{ media_id: input.mediaId }],
          },
        ],
      },
    );
    this.assertSnapSuccess(data, 'Failed to create Snapchat Saved Story');

    const savedStories = data.saved_stories as
      | Array<{ saved_story?: { id?: string } }>
      | undefined;
    const savedStoryId = savedStories?.[0]?.saved_story?.id ?? null;

    return {
      requestId: data.request_id ?? null,
      savedStoryId,
      postId: savedStoryId,
      raw: data,
    };
  }

  private assertSnapSuccess(
    data: Record<string, unknown>,
    fallbackMessage: string,
  ) {
    const status = String(data.request_status ?? '').toUpperCase();
    if (status && status !== 'SUCCESS') {
      const message =
        (typeof data.display_message === 'string' && data.display_message) ||
        (typeof data.debug_message === 'string' && data.debug_message) ||
        fallbackMessage;
      throw new BadRequestException(message);
    }
  }

  private async requestJson(
    method: 'GET' | 'POST',
    url: string,
    accessToken: string,
    payload?: unknown,
  ): Promise<Record<string, unknown>> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.request({
          method,
          url,
          data: payload,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }),
      );
      return (data ?? {}) as Record<string, unknown>;
    } catch (error) {
      this.logger.error(
        `Snapchat API failed (${url}): ${this.formatError(error)}`,
      );
      throw new BadRequestException('Snapchat API request failed');
    }
  }

  private async requestMultipart(
    url: string,
    accessToken: string,
    form: FormData,
  ): Promise<Record<string, unknown>> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, form, {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${accessToken}`,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 120000,
        }),
      );
      return (data ?? {}) as Record<string, unknown>;
    } catch (error) {
      this.logger.error(
        `Snapchat multipart upload failed (${url}): ${this.formatError(error)}`,
      );
      throw new BadRequestException('Snapchat media upload failed');
    }
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(
        `Snapchat token exchange failed: ${JSON.stringify(data)}`,
      );
      throw new BadRequestException('Failed to obtain Snapchat access token');
    }

    const expiresInRaw = data.expires_in;
    const expiresIn =
      typeof expiresInRaw === 'number'
        ? expiresInRaw
        : typeof expiresInRaw === 'string'
          ? Number(expiresInRaw)
          : null;

    return {
      accessToken,
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : null,
      tokenType: typeof data.token_type === 'string' ? data.token_type : null,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : null,
      scope: typeof data.scope === 'string' ? data.scope : null,
    };
  }

  private formatError(error: unknown): string {
    if (typeof error !== 'object' || error === null) {
      return String(error);
    }

    const axiosError = error as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };

    return JSON.stringify({
      status: axiosError.response?.status,
      data: axiosError.response?.data,
      message: axiosError.message,
    });
  }
}
