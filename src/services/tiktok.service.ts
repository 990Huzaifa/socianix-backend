import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SocialAccountsService } from './social-accounts.service';

export type CreateTikTokPostInput = {
  title?: string | null;
  description?: string | null;
  /** Public video URL (S3). Preferred when present. */
  videoUrl?: string | null;
  /** Public image URL(s) for photo posts. */
  imageUrls?: string[];
  /**
   * true = PUBLIC_TO_EVERYONE, false = SELF_ONLY.
   * Still constrained to creator-available privacy options.
   */
  privacyLevel?: boolean | null;
};

@Injectable()
export class TikTokService {
  private readonly logger = new Logger(TikTokService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  getClientKey(): string {
    return (
      this.configService.get<string>('Tiktok_CLIENT_KEY') ??
      this.configService.getOrThrow<string>('TIKTOK_CLIENT_KEY')
    );
  }

  getClientSecret(): string {
    return (
      this.configService.get<string>('Tiktok_CLIENT_SECRET') ??
      this.configService.getOrThrow<string>('TIKTOK_CLIENT_SECRET')
    );
  }

  getRedirectUri(): string {
    return (
      this.configService.get<string>('Tiktok_REDIRECT_URI') ??
      this.configService.get<string>('TIKTOK_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/tiktok/callback`
    );
  }

  getScopes(): string[] {
    const raw =
      this.configService.get<string>('TIKTOK_SCOPES') ??
      'user.info.basic,video.publish';

    return raw.split(/[\s,]+/).filter(Boolean);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_key: this.getClientKey(),
      scope: this.getScopes().join(','),
      response_type: 'code',
      redirect_uri: this.getRedirectUri(),
      state,
    });

    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  }

  async getAccessToken(code: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      client_key: this.getClientKey(),
      client_secret: this.getClientSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.getRedirectUri(),
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://open.tiktokapis.com/v2/oauth/token/',
          body.toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
          },
        ),
      );

      const tokenData =
        (data as { data?: Record<string, unknown> }).data ?? data;
      return this.mapTokenResponse(tokenData as Record<string, unknown>);
    } catch (error) {
      this.logger.error(
        `TikTok token exchange failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException(
        'Failed to exchange TikTok authorization code',
      );
    }
  }

  async getUserProfile(accessToken: string) {
    const { data } = await firstValueFrom(
      this.httpService.get(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 15000,
        },
      ),
    );

    const user =
      (data as { data?: { user?: Record<string, unknown> } }).data?.user ??
      (data as { user?: Record<string, unknown> }).user ??
      data;
    const platformUserId = String(
      user.open_id ?? user.union_id ?? 'unknown',
    );

    return {
      platformUserId,
      username: String(user.display_name ?? platformUserId),
      displayName:
        typeof user.display_name === 'string' ? user.display_name : null,
      profileImage:
        typeof user.avatar_url === 'string' ? user.avatar_url : null,
      email: null,
      raw: user,
    };
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);

    return {
      profile,
      metadata: {
        provider: 'tiktok',
        products: ['tiktok'],
        providerProfile: profile.raw,
      },
    };
  }

  /**
   * Direct-post video or photos via TikTok Content Posting API (PULL_FROM_URL).
   */
  async createPost(accessToken: string, input: CreateTikTokPostInput) {
    const videoUrl = input.videoUrl?.trim() || undefined;
    const imageUrls = (input.imageUrls ?? [])
      .map((url) => url?.trim())
      .filter(Boolean) as string[];

    if (!videoUrl && !imageUrls.length) {
      throw new BadRequestException(
        'TikTok post requires a videoUrl or at least one imageUrl',
      );
    }

    const creatorInfo = await this.queryCreatorInfo(accessToken);
    const privacyLevel = this.resolvePrivacyLevel(
      creatorInfo.privacy_level_options,
      input.privacyLevel,
    );

    const title = (input.title?.trim() || input.description?.trim() || '').slice(
      0,
      2200,
    );
    const description = (input.description?.trim() || title).slice(0, 2200);

    let publishId: string;

    if (videoUrl) {
      publishId = await this.initVideoPost(accessToken, {
        title: title || ' ',
        privacyLevel,
        videoUrl,
        disableComment: creatorInfo.comment_disabled === true,
        disableDuet: creatorInfo.duet_disabled === true,
        disableStitch: creatorInfo.stitch_disabled === true,
      });
    } else {
      publishId = await this.initPhotoPost(accessToken, {
        title: title || ' ',
        description,
        privacyLevel,
        imageUrls: imageUrls.slice(0, 35),
        disableComment: creatorInfo.comment_disabled === true,
      });
    }

    const status = await this.waitForPublishStatus(accessToken, publishId);

    this.logger.log(
      `Published TikTok post publishId=${publishId} status=${status.status}`,
    );

    return {
      publishId,
      status: status.status,
      postIds: status.postIds,
      raw: status.raw,
    };
  }

  async createPostForUser(userId: string, input: CreateTikTokPostInput) {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'tiktok',
      );
    const accessToken =
      this.socialAccountsService.assertHasAccessToken(account);

    return this.createPost(accessToken, input);
  }

  private async queryCreatorInfo(accessToken: string): Promise<{
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
  }> {
    const { data } = await this.request(
      'POST',
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
      accessToken,
      {},
    );

    this.assertTikTokOk(data, 'Failed to query TikTok creator info');
    return (data.data ?? {}) as {
      privacy_level_options?: string[];
      comment_disabled?: boolean;
      duet_disabled?: boolean;
      stitch_disabled?: boolean;
    };
  }

  private resolvePrivacyLevel(
    options: string[] | undefined,
    isPublic?: boolean | null,
  ): string {
    const available = Array.isArray(options) ? options.filter(Boolean) : [];
    const preferred =
      isPublic === true
        ? 'PUBLIC_TO_EVERYONE'
        : isPublic === false
          ? 'SELF_ONLY'
          : null;

    if (preferred && available.includes(preferred)) {
      return preferred;
    }

    // If public requested but not available, fall through preference order.
    // If private requested but not available, prefer SELF_ONLY then safest option.
    if (isPublic === false) {
      if (available.includes('SELF_ONLY')) {
        return 'SELF_ONLY';
      }
      return available[0] ?? 'SELF_ONLY';
    }

    const preferenceOrder = [
      'PUBLIC_TO_EVERYONE',
      'MUTUAL_FOLLOW_FRIENDS',
      'FOLLOWER_OF_CREATOR',
      'SELF_ONLY',
    ];

    for (const level of preferenceOrder) {
      if (available.includes(level)) {
        return level;
      }
    }

    return available[0] ?? 'SELF_ONLY';
  }

  private async initVideoPost(
    accessToken: string,
    input: {
      title: string;
      privacyLevel: string;
      videoUrl: string;
      disableComment: boolean;
      disableDuet: boolean;
      disableStitch: boolean;
    },
  ): Promise<string> {
    const { data } = await this.request(
      'POST',
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      accessToken,
      {
        post_info: {
          title: input.title,
          privacy_level: input.privacyLevel,
          disable_duet: input.disableDuet,
          disable_comment: input.disableComment,
          disable_stitch: input.disableStitch,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: input.videoUrl,
        },
      },
    );

    this.assertTikTokOk(data, 'Failed to init TikTok video publish');
    const publishId = (data.data as { publish_id?: string } | undefined)
      ?.publish_id;
    if (!publishId) {
      throw new BadRequestException('TikTok video publish did not return publish_id');
    }
    return publishId;
  }

  private async initPhotoPost(
    accessToken: string,
    input: {
      title: string;
      description: string;
      privacyLevel: string;
      imageUrls: string[];
      disableComment: boolean;
    },
  ): Promise<string> {
    const { data } = await this.request(
      'POST',
      'https://open.tiktokapis.com/v2/post/publish/content/init/',
      accessToken,
      {
        post_info: {
          title: input.title,
          description: input.description,
          privacy_level: input.privacyLevel,
          disable_comment: input.disableComment,
          auto_add_music: true,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: input.imageUrls,
        },
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
      },
    );

    this.assertTikTokOk(data, 'Failed to init TikTok photo publish');
    const publishId = (data.data as { publish_id?: string } | undefined)
      ?.publish_id;
    if (!publishId) {
      throw new BadRequestException('TikTok photo publish did not return publish_id');
    }
    return publishId;
  }

  private async waitForPublishStatus(
    accessToken: string,
    publishId: string,
    options?: { maxAttempts?: number; delayMs?: number },
  ) {
    const maxAttempts = options?.maxAttempts ?? 12;
    const delayMs = options?.delayMs ?? 2500;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { data } = await this.request(
        'POST',
        'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
        accessToken,
        { publish_id: publishId },
      );

      this.assertTikTokOk(data, 'Failed to fetch TikTok publish status');
      const payload = (data.data ?? {}) as {
        status?: string;
        publicaly_available_post_id?: Array<string | number>;
        public_available_post_id?: Array<string | number>;
        fail_reason?: string;
      };
      const status = String(payload.status ?? '').toUpperCase();

      if (
        status === 'PUBLISH_COMPLETE' ||
        status === 'SEND_TO_USER_INBOX' ||
        status === 'PUBLISHED'
      ) {
        const postIds = (
          payload.publicaly_available_post_id ??
          payload.public_available_post_id ??
          []
        ).map(String);

        return { status, postIds, raw: payload };
      }

      if (status === 'FAILED') {
        throw new BadRequestException(
          `TikTok publish failed: ${payload.fail_reason ?? status}`,
        );
      }

      if (attempt === maxAttempts) {
        this.logger.warn(
          `TikTok publish ${publishId} still ${status || 'unknown'} after ${maxAttempts} polls`,
        );
        return { status: status || 'PROCESSING', postIds: [], raw: payload };
      }

      await this.sleep(delayMs);
    }

    return { status: 'PROCESSING', postIds: [], raw: null };
  }

  private assertTikTokOk(
    data: { error?: { code?: string; message?: string } },
    fallbackMessage: string,
  ) {
    const code = data.error?.code;
    if (code && code !== 'ok') {
      throw new BadRequestException(
        data.error?.message?.trim() || fallbackMessage,
      );
    }
  }

  private async request(
    method: 'GET' | 'POST',
    url: string,
    accessToken: string,
    payload?: unknown,
  ) {
    try {
      return await firstValueFrom(
        this.httpService.request({
          method,
          url,
          data: payload,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          timeout: 60000,
        }),
      );
    } catch (error) {
      this.logger.error(
        `TikTok API failed (${url}): ${this.formatError(error)}`,
      );
      throw new BadRequestException('TikTok API request failed');
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(`TikTok token exchange failed: ${JSON.stringify(data)}`);
      throw new BadRequestException('Failed to obtain TikTok access token');
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
