import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SocialAccountsService } from './social-accounts.service';

export type CreateMetaPagePostInput = {
  message?: string | null;
  link?: string | null;
  /** Public image URLs (S3). One → /photos, 2+ → multi-photo /feed. */
  imageUrls?: string[];
  /** Public video URL for /{page-id}/videos file_url. */
  videoUrl?: string | null;
  /** Default true. Set false with scheduledPublishTime to schedule. */
  published?: boolean;
  /** Unix timestamp (seconds) when published=false. */
  scheduledPublishTime?: number;
};

export type CreateMetaInstagramPostInput = {
  caption?: string | null;
  imageUrls?: string[];
  videoUrl?: string | null;
};

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);
  private readonly graphVersion = 'v21.0';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  getAppId(): string {
    return (
      this.configService.get<string>('METADATA_APP_ID') ??
      this.configService.getOrThrow<string>('META_APP_ID')
    );
  }

  getAppSecret(): string {
    return (
      this.configService.get<string>('METADATA_APP_SECRET') ??
      this.configService.getOrThrow<string>('META_APP_SECRET')
    );
  }

  getRedirectUri(): string {
    return (
      this.configService.get<string>('METADATA_REDIRECT_URI') ??
      this.configService.get<string>('META_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/meta/callback`
    );
  }

  getScopes(): string[] {
    const raw =
      this.configService.get<string>('METADATA_SCOPES') ??
      this.configService.get<string>('META_SCOPES') ??
      'email public_profile pages_show_list pages_read_engagement pages_manage_posts instagram_basic instagram_content_publish';

    return raw.split(/[\s,]+/).filter(Boolean);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.getAppId(),
      redirect_uri: this.getRedirectUri(),
      response_type: 'code',
      scope: this.getScopes().join(','),
      state,
    });

    return `https://www.facebook.com/${this.graphVersion}/dialog/oauth?${params.toString()}`;
  }

  async getAccessToken(code: string): Promise<OAuthTokenResult> {
    const shortLived = await this.exchangeCode(code);
    try {
      return await this.exchangeLongLivedToken(shortLived.accessToken);
    } catch (error) {
      this.logger.warn(
        `Meta long-lived token exchange failed, using short-lived token: ${this.formatError(error)}`,
      );
      return shortLived;
    }
  }

  async getUserProfile(accessToken: string) {
    const { data } = await this.request(
      'GET',
      `https://graph.facebook.com/${this.graphVersion}/me?fields=id,name,email,picture.type(large)`,
      accessToken,
    );

    return {
      platformUserId: String(data.id),
      username: data.email ?? data.name ?? String(data.id),
      displayName: data.name ?? null,
      profileImage: data.picture?.data?.url ?? null,
      email: data.email ?? null,
      raw: data,
    };
  }

  async getFacebookPages(accessToken: string) {
    const { data } = await this.request(
      'GET',
      `https://graph.facebook.com/${this.graphVersion}/me/accounts?fields=id,name,username,access_token,category,tasks,picture.type(large),fan_count,link,instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}`,
      accessToken,
    );

    return data;
  }

  /**
   * Uses the stored Meta token for the user and returns Facebook pages
   * with ids and full provider payloads (including linked Instagram).
   */
  async facebookPageList(userId: string) {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'meta',
      );
    const accessToken =
      this.socialAccountsService.assertHasAccessToken(account);

    const pagesResponse = (await this.getFacebookPages(accessToken)) as {
      data?: Array<Record<string, unknown>>;
      paging?: unknown;
      [key: string]: unknown;
    };

    const pages = pagesResponse.data ?? [];

    return {
      pages: pages.map((page) => {
        const ig = page.instagram_business_account as
          | Record<string, unknown>
          | undefined;

        return {
          pageId: page.id ?? null,
          name: page.name ?? null,
          username: page.username ?? null,
          category: page.category ?? null,
          fanCount: page.fan_count ?? null,
          link: page.link ?? null,
          picture:
            (page.picture as { data?: { url?: string } } | undefined)?.data
              ?.url ?? null,
          pageAccessToken: page.access_token ?? null,
          instagram: ig
            ? {
                id: ig.id ?? null,
                username: ig.username ?? null,
                name: ig.name ?? null,
                profileImage: ig.profile_picture_url ?? null,
                followersCount: ig.followers_count ?? null,
                mediaCount: ig.media_count ?? null,
                raw: ig,
              }
            : null,
          page,
        };
      }),
      total: pages.length,
      raw: pagesResponse,
    };
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);

    let pagesRaw: unknown = null;
    let facebookPages: unknown[] = [];
    let instagramAccounts: unknown[] = [];

    try {
      pagesRaw = await this.getFacebookPages(accessToken);
      const pages =
        (pagesRaw as { data?: Array<Record<string, unknown>> }).data ?? [];

      facebookPages = pages.map((page) => ({
        id: page.id ?? null,
        name: page.name ?? null,
        username: page.username ?? null,
        category: page.category ?? null,
        tasks: page.tasks ?? null,
        pageAccessToken: page.access_token ?? null,
        page,
      }));

      instagramAccounts = pages
        .map((page) => {
          const ig = page.instagram_business_account as
            | Record<string, unknown>
            | undefined;
          if (!ig) {
            return null;
          }
          return {
            id: ig.id ?? null,
            username: ig.username ?? null,
            name: ig.name ?? null,
            profileImage: ig.profile_picture_url ?? null,
            followersCount: ig.followers_count ?? null,
            mediaCount: ig.media_count ?? null,
            linkedFacebookPageId: page.id ?? null,
            linkedFacebookPageName: page.name ?? null,
            instagram: ig,
          };
        })
        .filter(Boolean);
    } catch (error) {
      this.logger.warn(
        `Meta pages/Instagram fetch skipped: ${this.formatError(error)}`,
      );
    }

    return {
      profile,
      metadata: {
        email: profile.email,
        provider: 'meta',
        products: ['facebook', 'instagram'],
        providerProfile: profile.raw,
        facebookPages,
        instagramAccounts,
        pagesRaw,
      },
    };
  }

  /**
   * Create a Facebook Page post (text / link / photo(s) / video URL).
   * Requires a Page access token (from facebookPageList → pageAccessToken).
   */
  async createPagePost(
    pageAccessToken: string,
    pageId: string,
    input: CreateMetaPagePostInput,
  ) {
    const id = pageId?.trim();
    if (!id) {
      throw new BadRequestException('Meta pageId is required');
    }
    if (!pageAccessToken?.trim()) {
      throw new BadRequestException('Meta page access token is required');
    }

    const message = input.message?.trim() || undefined;
    const link = input.link?.trim() || undefined;
    const imageUrls = (input.imageUrls ?? [])
      .map((url) => url?.trim())
      .filter(Boolean) as string[];
    const videoUrl = input.videoUrl?.trim() || undefined;

    if (!message && !link && !imageUrls.length && !videoUrl) {
      throw new BadRequestException(
        'Meta page post requires message, link, imageUrls, or videoUrl',
      );
    }

    const published = input.published ?? true;
    const scheduledPublishTime = input.scheduledPublishTime;

    // Video post
    if (videoUrl) {
      const body: Record<string, unknown> = {
        file_url: videoUrl,
        description: message,
        published,
      };
      if (!published && scheduledPublishTime) {
        body.scheduled_publish_time = scheduledPublishTime;
      }

      const { data } = await this.request(
        'POST',
        `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(id)}/videos`,
        pageAccessToken,
        body,
      );

      return this.mapCreatedPost(data as Record<string, unknown>, 'video');
    }

    // Multi-photo: upload unpublished, then attach on /feed
    if (imageUrls.length > 1) {
      const mediaFbids: string[] = [];

      for (const url of imageUrls.slice(0, 10)) {
        const { data } = await this.request(
          'POST',
          `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(id)}/photos`,
          pageAccessToken,
          {
            url,
            published: false,
          },
        );
        const photoId = (data as { id?: string }).id;
        if (!photoId) {
          throw new BadRequestException('Failed to upload Meta page photo');
        }
        mediaFbids.push(photoId);
      }

      const body: Record<string, unknown> = {
        message,
        published,
        attached_media: mediaFbids.map((mediaFbid) => ({
          media_fbid: mediaFbid,
        })),
      };
      if (!published && scheduledPublishTime) {
        body.scheduled_publish_time = scheduledPublishTime;
        body.unpublished_content_type = 'SCHEDULED';
      }

      const { data } = await this.request(
        'POST',
        `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(id)}/feed`,
        pageAccessToken,
        body,
      );

      return this.mapCreatedPost(data as Record<string, unknown>, 'multi_photo');
    }

    // Single photo
    if (imageUrls.length === 1) {
      const body: Record<string, unknown> = {
        url: imageUrls[0],
        caption: message,
        published,
      };
      if (!published && scheduledPublishTime) {
        body.scheduled_publish_time = scheduledPublishTime;
        body.unpublished_content_type = 'SCHEDULED';
      }

      const { data } = await this.request(
        'POST',
        `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(id)}/photos`,
        pageAccessToken,
        body,
      );

      return this.mapCreatedPost(data as Record<string, unknown>, 'photo');
    }

    // Text / link feed post
    const body: Record<string, unknown> = {
      message,
      link,
      published,
    };
    if (!published && scheduledPublishTime) {
      body.scheduled_publish_time = scheduledPublishTime;
      body.unpublished_content_type = 'SCHEDULED';
    }

    const { data } = await this.request(
      'POST',
      `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(id)}/feed`,
      pageAccessToken,
      body,
    );

    return this.mapCreatedPost(data as Record<string, unknown>, 'feed');
  }

  /**
   * Create a Facebook Page post for a connected Meta user.
   * Resolves the Page access token from GET pages (facebookPageList).
   */
  async createPost(
    userId: string,
    pageId: string,
    input: CreateMetaPagePostInput,
  ) {
    const pageAccessToken = await this.resolvePageAccessToken(userId, pageId);
    return this.createPagePost(pageAccessToken, pageId, input);
  }

  /** Alias for createPost — same user-scoped Page publish flow. */
  async createPagePostForUser(
    userId: string,
    pageId: string,
    input: CreateMetaPagePostInput,
  ) {
    return this.createPost(userId, pageId, input);
  }

  /**
   * Create + publish an Instagram feed post (IMAGE / REELS / CAROUSEL).
   * Uses the linked Page access token from facebookPageList.
   */
  async createInstagramPost(
    pageAccessToken: string,
    instagramUserId: string,
    input: CreateMetaInstagramPostInput,
  ) {
    const igId = instagramUserId?.trim();
    if (!igId) {
      throw new BadRequestException('Instagram user id is required');
    }
    if (!pageAccessToken?.trim()) {
      throw new BadRequestException('Meta page access token is required');
    }

    const caption = input.caption?.trim() || undefined;
    const imageUrls = (input.imageUrls ?? [])
      .map((url) => url?.trim())
      .filter(Boolean) as string[];
    const videoUrl = input.videoUrl?.trim() || undefined;

    if (!imageUrls.length && !videoUrl) {
      throw new BadRequestException(
        'Instagram post requires at least one imageUrl or videoUrl',
      );
    }

    let creationId: string;

    if (imageUrls.length > 1) {
      creationId = await this.createInstagramCarousel(
        pageAccessToken,
        igId,
        imageUrls.slice(0, 10),
        caption,
      );
    } else if (imageUrls.length === 1) {
      creationId = await this.createInstagramContainer(pageAccessToken, igId, {
        image_url: imageUrls[0],
        caption,
      });
    } else {
      creationId = await this.createInstagramContainer(pageAccessToken, igId, {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
      });
    }

    await this.waitForInstagramContainer(pageAccessToken, creationId);

    const { data } = await this.request(
      'POST',
      `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(igId)}/media_publish`,
      pageAccessToken,
      { creation_id: creationId },
    );

    const mediaId =
      typeof (data as { id?: string }).id === 'string'
        ? (data as { id: string }).id
        : null;

    this.logger.log(
      `Published Instagram media ig=${igId} creationId=${creationId} mediaId=${mediaId ?? 'unknown'}`,
    );

    return {
      postId: mediaId,
      creationId,
      kind: imageUrls.length > 1 ? 'carousel' : imageUrls.length === 1 ? 'image' : 'reels',
      post: data as Record<string, unknown>,
    };
  }

  async createInstagramPostForUser(
    userId: string,
    instagramId: string,
    input: CreateMetaInstagramPostInput,
  ) {
    const { pageAccessToken } = await this.resolveInstagramPublishContext(
      userId,
      instagramId,
    );
    return this.createInstagramPost(pageAccessToken, instagramId, input);
  }

  private async resolveInstagramPublishContext(
    userId: string,
    instagramId: string,
  ) {
    const list = await this.facebookPageList(userId);
    const page = list.pages.find(
      (item) =>
        item.instagram &&
        String(item.instagram.id) === String(instagramId),
    );

    if (!page) {
      throw new BadRequestException(
        `Instagram account "${instagramId}" not found on any linked Facebook page`,
      );
    }

    const pageAccessToken = page.pageAccessToken;
    if (typeof pageAccessToken !== 'string' || !pageAccessToken) {
      throw new BadRequestException(
        `No page access token for Instagram "${instagramId}" linked page`,
      );
    }

    return {
      pageAccessToken,
      pageId: page.pageId != null ? String(page.pageId) : null,
    };
  }

  private async createInstagramCarousel(
    pageAccessToken: string,
    igUserId: string,
    imageUrls: string[],
    caption?: string,
  ): Promise<string> {
    const children: string[] = [];

    for (const url of imageUrls) {
      const childId = await this.createInstagramContainer(
        pageAccessToken,
        igUserId,
        {
          image_url: url,
          is_carousel_item: true,
        },
      );
      children.push(childId);
    }

    return this.createInstagramContainer(pageAccessToken, igUserId, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
    });
  }

  private async createInstagramContainer(
    pageAccessToken: string,
    igUserId: string,
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
      `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(igUserId)}/media`,
      pageAccessToken,
      body,
    );

    const id = (data as { id?: string }).id;
    if (!id) {
      throw new BadRequestException('Failed to create Instagram media container');
    }
    return id;
  }

  private async waitForInstagramContainer(
    pageAccessToken: string,
    creationId: string,
    options?: { maxAttempts?: number; delayMs?: number },
  ) {
    const maxAttempts = options?.maxAttempts ?? 20;
    const delayMs = options?.delayMs ?? 3000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { data } = await this.request(
        'GET',
        `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(creationId)}?fields=status_code`,
        pageAccessToken,
      );

      const status = String(
        (data as { status_code?: string }).status_code ?? '',
      ).toUpperCase();

      if (status === 'FINISHED') {
        return;
      }
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new BadRequestException(
          `Instagram media container failed with status ${status}`,
        );
      }

      if (attempt === maxAttempts) {
        this.logger.warn(
          `Instagram container ${creationId} still ${status || 'unknown'}; attempting publish`,
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  private async resolvePageAccessToken(
    userId: string,
    pageId: string,
  ): Promise<string> {
    const list = await this.facebookPageList(userId);
    const page = list.pages.find(
      (item) => String(item.pageId) === String(pageId),
    );

    if (!page) {
      throw new BadRequestException(
        `Facebook page "${pageId}" not found for this Meta account`,
      );
    }

    const token = page.pageAccessToken;
    if (typeof token !== 'string' || !token) {
      throw new BadRequestException(
        `No page access token available for Facebook page "${pageId}"`,
      );
    }

    return token;
  }

  private mapCreatedPost(
    data: Record<string, unknown>,
    kind: 'feed' | 'photo' | 'multi_photo' | 'video',
  ) {
    const postId =
      typeof data.id === 'string'
        ? data.id
        : typeof data.post_id === 'string'
          ? data.post_id
          : null;

    this.logger.log(`Created Meta page ${kind} post id=${postId ?? 'unknown'}`);

    return {
      postId,
      kind,
      post: data,
    };
  }

  private async exchangeCode(code: string): Promise<OAuthTokenResult> {
    const params = new URLSearchParams({
      client_id: this.getAppId(),
      client_secret: this.getAppSecret(),
      redirect_uri: this.getRedirectUri(),
      code,
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/${this.graphVersion}/oauth/access_token?${params.toString()}`,
          { timeout: 15000 },
        ),
      );
      return this.mapTokenResponse(data as Record<string, unknown>);
    } catch (error) {
      this.logger.error(
        `Meta code exchange failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException('Failed to exchange Meta authorization code');
    }
  }

  private async exchangeLongLivedToken(
    shortLivedToken: string,
  ): Promise<OAuthTokenResult> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.getAppId(),
      client_secret: this.getAppSecret(),
      fb_exchange_token: shortLivedToken,
    });

    const { data } = await firstValueFrom(
      this.httpService.get(
        `https://graph.facebook.com/${this.graphVersion}/oauth/access_token?${params.toString()}`,
        { timeout: 15000 },
      ),
    );

    return this.mapTokenResponse(data as Record<string, unknown>);
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(`Meta token exchange failed: ${JSON.stringify(data)}`);
      throw new BadRequestException('Failed to obtain Meta access token');
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
      this.logger.error(`Meta API failed (${url}): ${this.formatError(error)}`);
      throw new BadRequestException('Meta API request failed');
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
