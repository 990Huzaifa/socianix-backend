import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SocialAccountsService } from './social-accounts.service';

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

  private async request(method: 'GET' | 'POST', url: string, accessToken: string) {
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
