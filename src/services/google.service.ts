import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SocialAccountsService } from './social-accounts.service';

type GoogleAccount = {
  name?: string;
  accountName?: string;
  type?: string;
  verificationState?: string;
  [key: string]: unknown;
};

type GoogleLocation = {
  name?: string;
  title?: string;
  [key: string]: unknown;
};

type YouTubeChannel = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    publishedAt?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
    country?: string;
    defaultLanguage?: string;
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
      likes?: string;
    };
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
  status?: {
    privacyStatus?: string;
    isLinked?: boolean;
    madeForKids?: boolean;
  };
  [key: string]: unknown;
};

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);
  private readonly locationReadMask = [
    'name',
    'title',
    'storefrontAddress',
    'websiteUri',
    'phoneNumbers',
    'categories',
    'regularHours',
    'specialHours',
    'serviceArea',
    'labels',
    'adWordsLocationExtensions',
    'latlng',
    'openInfo',
    'metadata',
    'profile',
    'relationshipData',
    'moreHours',
  ].join(',');

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  getRedirectUri(): string {
    return (
      this.configService.get<string>('GOOGLE_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/google/callback`
    );
  }

  async getAccessToken(code: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      code,
      client_id: this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      redirect_uri: this.getRedirectUri(),
      grant_type: 'authorization_code',
    });

    const data = await this.postForm('https://oauth2.googleapis.com/token', body);
    return this.mapTokenResponse(data);
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    });

    const data = await this.postForm('https://oauth2.googleapis.com/token', body);
    return this.mapTokenResponse(data);
  }

  /**
   * Refresh Google access token for a connected user and persist it.
   * Intended for cron / ops: GET /google/refresh-token?userId=...
   */
  async refreshAccessTokenByUserId(userId: string) {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'google',
      );

    if (!account.refreshToken) {
      throw new UnauthorizedException(
        'No Google refresh token stored for this user. Reconnect Google.',
      );
    }

    const refreshed = await this.refreshToken(account.refreshToken);
    const updated = await this.socialAccountsService.updateTokens(
      account.id,
      refreshed,
    );

    this.logger.log(
      `Refreshed Google access token for user=${userId} account=${updated.id}`,
    );

    return {
      message: 'Google access token refreshed successfully',
      userId,
      accountId: updated.id,
      expiresAt: updated.expiresAt,
      lastSyncedAt: updated.lastSyncedAt,
    };
  }

  /**
   * Refresh all active Google social accounts (for a single cron run).
   */
  async refreshAllAccessTokens() {
    const accounts =
      await this.socialAccountsService.findAllActiveByPlatform('google');

    const results: Array<{
      userId: string;
      accountId: string;
      status: 'refreshed' | 'skipped' | 'failed';
      expiresAt?: Date | null;
      error?: string;
    }> = [];

    for (const account of accounts) {
      if (!account.refreshToken) {
        results.push({
          userId: account.userId,
          accountId: account.id,
          status: 'skipped',
          error: 'missing_refresh_token',
        });
        continue;
      }

      try {
        const refreshed = await this.refreshToken(account.refreshToken);
        const updated = await this.socialAccountsService.updateTokens(
          account.id,
          refreshed,
        );
        results.push({
          userId: account.userId,
          accountId: updated.id,
          status: 'refreshed',
          expiresAt: updated.expiresAt,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed refreshing Google token for user=${account.userId}: ${message}`,
        );
        results.push({
          userId: account.userId,
          accountId: account.id,
          status: 'failed',
          error: message,
        });
      }
    }

    return {
      message: 'Google token refresh job finished',
      total: accounts.length,
      refreshed: results.filter((r) => r.status === 'refreshed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }

  async getUserProfile(accessToken: string) {
    const { data } = await this.request(
      'GET',
      'https://www.googleapis.com/oauth2/v2/userinfo',
      accessToken,
    );

    return {
      platformUserId: String(data.id),
      username: data.email ?? data.name ?? String(data.id),
      displayName: data.name ?? null,
      profileImage: data.picture ?? null,
      email: data.email ?? null,
      raw: data,
    };
  }

  async getAccount(accessToken: string) {
    const { data } = await this.request(
      'GET',
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      accessToken,
    );

    return data;
  }

  async getLocation(accessToken: string, accountName: string) {
    const encodedMask = encodeURIComponent(this.locationReadMask);
    const { data } = await this.request(
      'GET',
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${encodedMask}&pageSize=100`,
      accessToken,
    );

    return data;
  }

  async getBusinessProfile(accessToken: string, locationName: string) {
    const encodedMask = encodeURIComponent(this.locationReadMask);
    const { data } = await this.request(
      'GET',
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?readMask=${encodedMask}`,
      accessToken,
    );

    return data;
  }

  /**
   * Uses the stored Google token for the user and returns all Business Profile
   * accounts + locations with their ids/names and full provider payloads.
   */
  async getBusinessProfilesForUser(userId: string) {
    const accessToken = await this.resolveAccessToken(userId);
    return this.getBusinessProfiles(accessToken);
  }

  /**
   * Uses the stored Google token for the user and returns all YouTube
   * channels owned by that Google account (a user may have several).
   */
  async getYouTubeChannelsForUser(userId: string) {
    const accessToken = await this.resolveAccessToken(userId);
    return this.getYouTubeChannels(accessToken);
  }

  async getYouTubeChannels(accessToken: string) {
    const channels: YouTubeChannel[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        part: 'snippet,contentDetails,statistics,status',
        mine: 'true',
        maxResults: '50',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const { data } = await this.request(
        'GET',
        `https://www.googleapis.com/youtube/v3/channels?${params.toString()}`,
        accessToken,
      );

      const page = data as {
        items?: YouTubeChannel[];
        nextPageToken?: string;
      };

      channels.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return {
      channels: channels.map((channel) => ({
        channelId: channel.id ?? null,
        title: channel.snippet?.title ?? null,
        customUrl: channel.snippet?.customUrl ?? null,
        description: channel.snippet?.description ?? null,
        thumbnail:
          channel.snippet?.thumbnails?.high?.url ??
          channel.snippet?.thumbnails?.medium?.url ??
          channel.snippet?.thumbnails?.default?.url ??
          null,
        country: channel.snippet?.country ?? null,
        publishedAt: channel.snippet?.publishedAt ?? null,
        uploadsPlaylistId:
          channel.contentDetails?.relatedPlaylists?.uploads ?? null,
        statistics: {
          viewCount: channel.statistics?.viewCount ?? null,
          subscriberCount: channel.statistics?.subscriberCount ?? null,
          hiddenSubscriberCount:
            channel.statistics?.hiddenSubscriberCount ?? null,
          videoCount: channel.statistics?.videoCount ?? null,
        },
        status: {
          privacyStatus: channel.status?.privacyStatus ?? null,
          isLinked: channel.status?.isLinked ?? null,
          madeForKids: channel.status?.madeForKids ?? null,
        },
        channel,
      })),
      totalChannels: channels.length,
    };
  }

  async getBusinessProfiles(accessToken: string) {
    const accountsResponse = (await this.getAccount(accessToken)) as {
      accounts?: GoogleAccount[];
    };
    const accounts = accountsResponse.accounts ?? [];

    const profiles: Array<{
      accountId: string | null;
      accountName: string | null;
      account: GoogleAccount;
      locations: Array<{
        locationId: string | null;
        locationName: string | null;
        title: string | null;
        location: GoogleLocation;
      }>;
      locationsRaw: unknown;
    }> = [];

    for (const account of accounts) {
      const accountId = this.extractResourceId(account.name);
      let locations: GoogleLocation[] = [];
      let locationsRaw: unknown = null;

      if (account.name) {
        try {
          locationsRaw = await this.getLocation(accessToken, account.name);
          locations =
            (locationsRaw as { locations?: GoogleLocation[] }).locations ?? [];
        } catch (error) {
          this.logger.warn(
            `Failed to fetch locations for ${account.name}: ${this.formatError(error)}`,
          );
        }
      }

      profiles.push({
        accountId,
        accountName: account.name ?? null,
        account,
        locations: locations.map((location) => ({
          locationId: this.extractResourceId(location.name),
          locationName: location.name ?? null,
          title: location.title ?? null,
          location,
        })),
        locationsRaw,
      });
    }

    return {
      accounts: profiles,
      totalAccounts: profiles.length,
      totalLocations: profiles.reduce(
        (sum, item) => sum + item.locations.length,
        0,
      ),
    };
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);

    let account: unknown = null;
    let locations: unknown = null;
    let businessProfile: unknown = null;

    try {
      account = await this.getAccount(accessToken);
      const accountName = (account as { accounts?: { name?: string }[] })
        ?.accounts?.[0]?.name;

      if (accountName) {
        locations = await this.getLocation(accessToken, accountName);
        const locationName = (locations as { locations?: { name?: string }[] })
          ?.locations?.[0]?.name;

        if (locationName) {
          businessProfile = await this.getBusinessProfile(
            accessToken,
            locationName,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Google business data fetch skipped: ${this.formatError(error)}`,
      );
    }

    return {
      profile,
      metadata: {
        email: profile.email,
        googleAccount: account,
        locations,
        businessProfile,
      },
    };
  }

  private async resolveAccessToken(userId: string): Promise<string> {
    let account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'google',
      );

    const isExpired =
      account.expiresAt != null && account.expiresAt.getTime() <= Date.now();

    if (isExpired) {
      if (!account.refreshToken) {
        throw new UnauthorizedException(
          'Google access token expired and no refresh token is stored. Reconnect Google.',
        );
      }

      const refreshed = await this.refreshToken(account.refreshToken);
      account = await this.socialAccountsService.updateTokens(
        account.id,
        refreshed,
      );
    }

    return this.socialAccountsService.assertHasAccessToken(account);
  }

  private extractResourceId(resourceName?: string | null): string | null {
    if (!resourceName) {
      return null;
    }
    const parts = resourceName.split('/');
    return parts[parts.length - 1] ?? null;
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(`Google token exchange failed: ${JSON.stringify(data)}`);
      throw new BadRequestException('Failed to obtain Google access token');
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

  private async postForm(url: string, body: URLSearchParams) {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
        }),
      );
      return data as Record<string, unknown>;
    } catch (error) {
      this.logger.error(
        `Google token request failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException('Failed to exchange Google authorization code');
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
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 20000,
        }),
      );
    } catch (error) {
      this.logger.error(`Google API request failed (${url}): ${this.formatError(error)}`);
      throw new BadRequestException('Google API request failed');
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
