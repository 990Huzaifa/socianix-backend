import { createHash, randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import FormData from 'form-data';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SocialAccountsService } from './social-accounts.service';

const API_BASE = 'https://api.x.com';
const MEDIA_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

export type CreateXPostInput = {
  text?: string | null;
  /** Public image URL(s). Up to 4. Ignored when videoUrl is set. */
  imageUrls?: string[];
  /** Public video URL. X allows 1 video OR up to 4 images, not both. */
  videoUrl?: string | null;
};

@Injectable()
export class XService {
  private readonly logger = new Logger(XService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  getClientId(): string {
    return this.configService.getOrThrow<string>('X_CLIENT_ID');
  }

  getClientSecret(): string {
    return this.configService.getOrThrow<string>('X_CLIENT_SECRET');
  }

  getRedirectUri(): string {
    return (
      this.configService.get<string>('X_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/x/callback`
    );
  }

  getScopes(): string[] {
    const raw =
      this.configService.get<string>('X_SCOPES') ??
      'tweet.read tweet.write users.read offline.access media.write';

    return raw.split(/[\s,]+/).filter(Boolean);
  }

  createPkcePair() {
    const codeVerifier = randomBytes(32)
      .toString('base64url')
      .replace(/=/g, '');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url')
      .replace(/=/g, '');

    return { codeVerifier, codeChallenge };
  }

  getAuthorizationUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.getClientId(),
      redirect_uri: this.getRedirectUri(),
      scope: this.getScopes().join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }

  async getAccessToken(
    code: string,
    codeVerifier: string,
  ): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.getRedirectUri(),
      code_verifier: codeVerifier,
      client_id: this.getClientId(),
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://api.twitter.com/2/oauth2/token',
          body.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${Buffer.from(
                `${this.getClientId()}:${this.getClientSecret()}`,
              ).toString('base64')}`,
            },
            timeout: 15000,
          },
        ),
      );

      return this.mapTokenResponse(data as Record<string, unknown>);
    } catch (error) {
      this.logger.error(`X token exchange failed: ${this.formatError(error)}`);
      throw new BadRequestException('Failed to exchange X authorization code');
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.getClientId(),
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://api.twitter.com/2/oauth2/token',
          body.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${Buffer.from(
                `${this.getClientId()}:${this.getClientSecret()}`,
              ).toString('base64')}`,
            },
            timeout: 15000,
          },
        ),
      );

      return this.mapTokenResponse(data as Record<string, unknown>);
    } catch (error) {
      this.logger.error(`X refresh token failed: ${this.formatError(error)}`);
      throw new BadRequestException('Failed to refresh X access token');
    }
  }

  async getUserProfile(accessToken: string) {
    const { data } = await this.request(
      'GET',
      `${API_BASE}/2/users/me?user.fields=id,name,username,profile_image_url,description,public_metrics,verified,created_at`,
      accessToken,
    );

    const user = (data as { data?: Record<string, unknown> }).data ?? data;

    return {
      platformUserId: String(user.id),
      username: String(user.username ?? user.id),
      displayName:
        typeof user.name === 'string'
          ? user.name
          : typeof user.username === 'string'
            ? user.username
            : null,
      profileImage:
        typeof user.profile_image_url === 'string'
          ? user.profile_image_url
          : null,
      email: null,
      raw: user,
    };
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);

    return {
      profile,
      metadata: {
        provider: 'x',
        products: ['x'],
        providerProfile: profile.raw,
      },
    };
  }

  async getProfileForUser(userId: string) {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'x',
      );
    const accessToken =
      this.socialAccountsService.assertHasAccessToken(account);
    const profile = await this.getUserProfile(accessToken);

    return {
      userId: profile.platformUserId,
      username: profile.username,
      displayName: profile.displayName,
      profileImage: profile.profileImage,
      profile: profile.raw,
    };
  }

  /**
   * Create a Post via POST /2/tweets (text and/or media).
   * Media is uploaded first (chunked v2), then attached by media_id.
   */
  async createPost(accessToken: string, input: CreateXPostInput) {
    const text = (input.text?.trim() || '').slice(0, 25000);
    const imageUrls = (input.imageUrls ?? [])
      .map((url) => url?.trim())
      .filter(Boolean) as string[];
    const videoUrl = input.videoUrl?.trim() || undefined;

    if (!text && !imageUrls.length && !videoUrl) {
      throw new BadRequestException(
        'X post requires text, imageUrls, or videoUrl',
      );
    }

    const mediaIds: string[] = [];

    if (videoUrl) {
      const mediaId = await this.uploadMediaFromUrl(accessToken, videoUrl, {
        preferVideo: true,
      });
      mediaIds.push(mediaId);
    } else if (imageUrls.length) {
      for (const url of imageUrls.slice(0, 4)) {
        const mediaId = await this.uploadMediaFromUrl(accessToken, url, {
          preferVideo: false,
        });
        mediaIds.push(mediaId);
      }
    }

    const body: Record<string, unknown> = {};
    if (text) {
      body.text = text;
    }
    if (mediaIds.length) {
      body.media = { media_ids: mediaIds };
    }

    const data = await this.requestJson(
      'POST',
      `${API_BASE}/2/tweets`,
      accessToken,
      body,
    );

    const tweet = (data.data ?? data) as { id?: string; text?: string };
    const postId = typeof tweet.id === 'string' ? tweet.id : null;
    if (!postId) {
      throw new BadRequestException('X create tweet did not return an id');
    }

    this.logger.log(`Created X post postId=${postId}`);

    return {
      postId,
      text: typeof tweet.text === 'string' ? tweet.text : text || null,
      mediaIds,
      raw: data,
    };
  }

  async createPostForUser(userId: string, input: CreateXPostInput) {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'x',
      );
    const accessToken =
      this.socialAccountsService.assertHasAccessToken(account);
    return this.createPost(accessToken, input);
  }

  private async uploadMediaFromUrl(
    accessToken: string,
    url: string,
    options: { preferVideo: boolean },
  ): Promise<string> {
    const { buffer, contentType } = await this.downloadMedia(url);
    const mediaType = this.resolveMediaType(
      contentType,
      url,
      options.preferVideo,
    );
    const mediaCategory = this.resolveMediaCategory(mediaType);

    return this.uploadMediaChunked(
      accessToken,
      buffer,
      mediaType,
      mediaCategory,
    );
  }

  private resolveMediaType(
    contentType: string | undefined,
    url: string,
    preferVideo: boolean,
  ): string {
    const normalized = (contentType || '').split(';')[0].trim().toLowerCase();
    if (normalized.startsWith('image/') || normalized.startsWith('video/')) {
      return normalized;
    }

    const lowerUrl = url.toLowerCase();
    if (preferVideo || /\.(mp4|mov|webm)(\?|$)/.test(lowerUrl)) {
      return 'video/mp4';
    }
    if (/\.gif(\?|$)/.test(lowerUrl)) {
      return 'image/gif';
    }
    if (/\.png(\?|$)/.test(lowerUrl)) {
      return 'image/png';
    }
    if (/\.webp(\?|$)/.test(lowerUrl)) {
      return 'image/webp';
    }
    return 'image/jpeg';
  }

  private resolveMediaCategory(mediaType: string): string {
    if (mediaType === 'image/gif') {
      return 'tweet_gif';
    }
    if (mediaType.startsWith('video/')) {
      return 'tweet_video';
    }
    return 'tweet_image';
  }

  private async uploadMediaChunked(
    accessToken: string,
    buffer: Buffer,
    mediaType: string,
    mediaCategory: string,
  ): Promise<string> {
    const initData = await this.requestJson(
      'POST',
      `${API_BASE}/2/media/upload/initialize`,
      accessToken,
      {
        media_type: mediaType,
        total_bytes: buffer.length,
        media_category: mediaCategory,
      },
    );

    const mediaId = this.extractMediaId(initData);
    if (!mediaId) {
      throw new BadRequestException(
        'X media initialize did not return media id',
      );
    }

    const chunks = this.splitBuffer(buffer, MEDIA_CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i += 1) {
      await this.appendMediaChunk(accessToken, mediaId, chunks[i], i);
    }

    const finalizeData = await this.requestJson(
      'POST',
      `${API_BASE}/2/media/upload/${encodeURIComponent(mediaId)}/finalize`,
      accessToken,
    );

    await this.waitForMediaReady(accessToken, mediaId, finalizeData);

    this.logger.log(
      `Uploaded X media mediaId=${mediaId} type=${mediaType} category=${mediaCategory}`,
    );

    return mediaId;
  }

  private async appendMediaChunk(
    accessToken: string,
    mediaId: string,
    chunk: Buffer,
    segmentIndex: number,
  ) {
    const form = new FormData();
    form.append('segment_index', String(segmentIndex));
    form.append('media', chunk, {
      filename: `chunk-${segmentIndex}.bin`,
      contentType: 'application/octet-stream',
    });

    try {
      await firstValueFrom(
        this.httpService.post(
          `${API_BASE}/2/media/upload/${encodeURIComponent(mediaId)}/append`,
          form,
          {
            headers: {
              ...form.getHeaders(),
              Authorization: `Bearer ${accessToken}`,
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 120000,
          },
        ),
      );
    } catch (error) {
      this.logger.error(
        `X media append failed mediaId=${mediaId} segment=${segmentIndex}: ${this.formatError(error)}`,
      );
      throw new BadRequestException('X media upload failed');
    }
  }

  private async waitForMediaReady(
    accessToken: string,
    mediaId: string,
    finalizeData: Record<string, unknown>,
  ) {
    let processingInfo = this.extractProcessingInfo(finalizeData);
    if (!processingInfo) {
      return;
    }

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const state = String(processingInfo.state ?? '').toLowerCase();
      if (state === 'succeeded') {
        return;
      }
      if (state === 'failed') {
        throw new BadRequestException('X media processing failed');
      }

      const waitSecs = Number(processingInfo.check_after_secs ?? 2);
      await this.sleep(Math.max(1, waitSecs) * 1000);

      const statusData = await this.requestJson(
        'GET',
        `${API_BASE}/2/media/upload?media_id=${encodeURIComponent(mediaId)}`,
        accessToken,
      );
      processingInfo = this.extractProcessingInfo(statusData);
      if (!processingInfo) {
        return;
      }
    }

    throw new BadRequestException('X media processing timed out');
  }

  private extractMediaId(data: Record<string, unknown>): string | null {
    const nested = data.data as Record<string, unknown> | undefined;
    const id = nested?.id ?? data.id ?? data.media_id_string ?? data.media_id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
  }

  private extractProcessingInfo(
    data: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const nested = data.data as Record<string, unknown> | undefined;
    const info =
      (nested?.processing_info as Record<string, unknown> | undefined) ??
      (data.processing_info as Record<string, unknown> | undefined);
    return info && typeof info === 'object' ? info : null;
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

  private async downloadMedia(
    url: string,
  ): Promise<{ buffer: Buffer; contentType?: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'arraybuffer',
          timeout: 120000,
        }),
      );
      const contentTypeHeader = response.headers?.['content-type'];
      const contentType =
        typeof contentTypeHeader === 'string'
          ? contentTypeHeader
          : Array.isArray(contentTypeHeader)
            ? contentTypeHeader[0]
            : undefined;

      return {
        buffer: Buffer.from(response.data),
        contentType,
      };
    } catch (error) {
      this.logger.error(`X media download failed: ${this.formatError(error)}`);
      throw new BadRequestException('Failed to download media for X post');
    }
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(`X token exchange failed: ${JSON.stringify(data)}`);
      throw new BadRequestException('Failed to obtain X access token');
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
      tokenType:
        typeof data.token_type === 'string' ? data.token_type : 'bearer',
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : null,
      scope: typeof data.scope === 'string' ? data.scope : null,
    };
  }

  private async request(
    method: 'GET' | 'POST',
    url: string,
    accessToken: string,
  ) {
    try {
      return await firstValueFrom(
        this.httpService.request({
          method,
          url,
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 20000,
        }),
      );
    } catch (error) {
      this.logger.error(`X API failed (${url}): ${this.formatError(error)}`);
      throw new BadRequestException('X API request failed');
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
            ...(payload !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          timeout: 60000,
        }),
      );
      return (data ?? {}) as Record<string, unknown>;
    } catch (error) {
      this.logger.error(`X API failed (${url}): ${this.formatError(error)}`);
      throw new BadRequestException('X API request failed');
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
