import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SocialAccountsService } from './social-accounts.service';

export type CreateThreadsPostInput = {
  text?: string | null;
  /** Public image URL(s). One → IMAGE; 2+ → CAROUSEL. */
  imageUrls?: string[];
  /** Public video URL → VIDEO (ignored if images are provided). */
  videoUrl?: string | null;
};

@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);
  private readonly apiVersion = 'v1.0';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  getAppId(): string {
    return this.configService.getOrThrow<string>('THREAD_APP_ID');
  }

  getAppSecret(): string {
    return (
      this.configService.get<string>('THREAD_API_SECRET') ??
      this.configService.getOrThrow<string>('THREAD_APP_SECRET')
    );
  }

  getRedirectUri(): string {
    return (
      this.configService.get<string>('THREAD_API_URL') ??
      this.configService.get<string>('THREAD_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/thread/callback`
    );
  }

  getScopes(): string[] {
    const raw =
      this.configService.get<string>('THREAD_SCOPES') ??
      'threads_basic threads_content_publish';

    return raw.split(/[\s,]+/).filter(Boolean);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.getAppId(),
      redirect_uri: this.getRedirectUri(),
      scope: this.getScopes().join(','),
      response_type: 'code',
      state,
    });

    return `https://threads.net/oauth/authorize?${params.toString()}`;
  }

  async getAccessToken(code: string): Promise<OAuthTokenResult> {
    const shortLived = await this.exchangeCode(code);
    try {
      return await this.exchangeLongLivedToken(shortLived.accessToken);
    } catch (error) {
      this.logger.warn(
        `Threads long-lived token exchange failed, using short-lived token: ${this.formatError(error)}`,
      );
      return shortLived;
    }
  }

  async getUserProfile(accessToken: string) {
    const { data } = await this.request(
      'GET',
      `https://graph.threads.net/${this.apiVersion}/me?fields=id,username,name,threads_profile_picture_url,threads_biography`,
      accessToken,
    );
    return {
      platformUserId: String(data.id),
      username: data.username ?? data.name ?? String(data.id),
      displayName: data.name ?? data.username ?? null,
      profileImage: data.threads_profile_picture_url ?? null,
      email: null,
      raw: data,
    };
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);

    return {
      profile,
      metadata: {
        provider: 'thread',
        products: ['threads'],
        providerProfile: profile.raw,
        biography: profile.raw?.threads_biography ?? null,
      },
    };
  }

  /**
   * Create + publish a Threads post (TEXT / IMAGE / VIDEO / CAROUSEL).
   * Two-step Graph flow: container → wait ready → threads_publish.
   */
  async createPost(
    accessToken: string,
    threadsUserId: string,
    input: CreateThreadsPostInput,
  ) {
    const userId = threadsUserId?.trim();
    if (!userId) {
      throw new BadRequestException('Threads user id is required');
    }

    const text = input.text?.trim() || undefined;
    const imageUrls = (input.imageUrls ?? [])
      .map((url) => url?.trim())
      .filter(Boolean) as string[];
    const videoUrl = input.videoUrl?.trim() || undefined;

    if (!text && !imageUrls.length && !videoUrl) {
      throw new BadRequestException(
        'Threads post requires text, imageUrls, or videoUrl',
      );
    }

    let creationId: string;

    if (imageUrls.length > 1) {
      creationId = await this.createCarouselContainer(
        accessToken,
        userId,
        imageUrls.slice(0, 20),
        text,
      );
    } else if (imageUrls.length === 1) {
      creationId = await this.createMediaContainer(accessToken, userId, {
        media_type: 'IMAGE',
        image_url: imageUrls[0],
        text,
      });
    } else if (videoUrl) {
      creationId = await this.createMediaContainer(accessToken, userId, {
        media_type: 'VIDEO',
        video_url: videoUrl,
        text,
      });
    } else {
      creationId = await this.createMediaContainer(accessToken, userId, {
        media_type: 'TEXT',
        text,
      });
    }

    await this.waitForContainerReady(accessToken, creationId);

    const { data } = await this.request(
      'POST',
      `https://graph.threads.net/${this.apiVersion}/${encodeURIComponent(userId)}/threads_publish`,
      accessToken,
      { creation_id: creationId },
    );

    const postId =
      typeof (data as { id?: string }).id === 'string'
        ? (data as { id: string }).id
        : null;

    this.logger.log(
      `Published Threads post user=${userId} creationId=${creationId} postId=${postId ?? 'unknown'}`,
    );

    return {
      postId,
      creationId,
      post: data as Record<string, unknown>,
    };
  }

  /**
   * Create + publish using the stored Threads token for the user.
   */
  async createPostForUser(userId: string, input: CreateThreadsPostInput) {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'thread',
      );
    const accessToken =
      this.socialAccountsService.assertHasAccessToken(account);

    return this.createPost(accessToken, account.platformUserId, input);
  }

  private async createCarouselContainer(
    accessToken: string,
    threadsUserId: string,
    imageUrls: string[],
    text?: string,
  ): Promise<string> {
    const children: string[] = [];

    for (const url of imageUrls) {
      const childId = await this.createMediaContainer(
        accessToken,
        threadsUserId,
        {
          media_type: 'IMAGE',
          image_url: url,
          is_carousel_item: true,
        },
      );
      children.push(childId);
    }

    return this.createMediaContainer(accessToken, threadsUserId, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      text,
    });
  }

  private async createMediaContainer(
    accessToken: string,
    threadsUserId: string,
    fields: Record<string, string | boolean | undefined>,
  ): Promise<string> {
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      body[key] = value;
    }

    const { data } = await this.request(
      'POST',
      `https://graph.threads.net/${this.apiVersion}/${encodeURIComponent(threadsUserId)}/threads`,
      accessToken,
      body,
    );

    const id = (data as { id?: string }).id;
    if (!id) {
      this.logger.error(
        `Threads container create failed: ${JSON.stringify(data)}`,
      );
      throw new BadRequestException('Failed to create Threads media container');
    }

    return id;
  }

  private async waitForContainerReady(
    accessToken: string,
    creationId: string,
    options?: { maxAttempts?: number; delayMs?: number },
  ) {
    const maxAttempts = options?.maxAttempts ?? 20;
    const delayMs = options?.delayMs ?? 3000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { data } = await this.request(
        'GET',
        `https://graph.threads.net/${this.apiVersion}/${encodeURIComponent(creationId)}?fields=status,error_message`,
        accessToken,
      );

      const status = String(
        (data as { status?: string }).status ?? '',
      ).toUpperCase();

      if (status === 'FINISHED' || status === 'PUBLISHED') {
        return;
      }

      if (status === 'ERROR' || status === 'EXPIRED') {
        const errorMessage =
          (data as { error_message?: string }).error_message ?? status;
        throw new BadRequestException(
          `Threads media container failed: ${errorMessage}`,
        );
      }

      // TEXT containers are often ready immediately; still allow a short wait.
      if (attempt === maxAttempts) {
        this.logger.warn(
          `Threads container ${creationId} still ${status || 'unknown'} after ${maxAttempts} polls; attempting publish`,
        );
        return;
      }

      await this.sleep(delayMs);
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async exchangeCode(code: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      client_id: this.getAppId(),
      client_secret: this.getAppSecret(),
      grant_type: 'authorization_code',
      redirect_uri: this.getRedirectUri(),
      code,
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://graph.threads.net/oauth/access_token',
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
        `Threads code exchange failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException(
        'Failed to exchange Threads authorization code',
      );
    }
  }

  private async exchangeLongLivedToken(
    shortLivedToken: string,
  ): Promise<OAuthTokenResult> {
    const params = new URLSearchParams({
      grant_type: 'th_exchange_token',
      client_secret: this.getAppSecret(),
      access_token: shortLivedToken,
    });

    const { data } = await firstValueFrom(
      this.httpService.get(
        `https://graph.threads.net/access_token?${params.toString()}`,
        { timeout: 15000 },
      ),
    );

    return this.mapTokenResponse(data as Record<string, unknown>);
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(
        `Threads token exchange failed: ${JSON.stringify(data)}`,
      );
      throw new BadRequestException('Failed to obtain Threads access token');
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
      refreshToken: null,
      tokenType: typeof data.token_type === 'string' ? data.token_type : 'bearer',
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : null,
      scope: typeof data.scope === 'string' ? data.scope : null,
    };
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
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 60000,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Threads API failed (${url}): ${this.formatError(error)}`,
      );
      throw new BadRequestException('Threads API request failed');
    }
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
