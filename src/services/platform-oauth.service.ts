import {
  BadRequestException,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConnectPlatform } from '../connect/connect-platform.type';
import {
  OAuthProfileInfo,
  OAuthTokenResult,
} from '../connect/types/oauth.types';
import { GoogleService } from './google.service';
import { MetaService } from './meta.service';
import { PinterestService } from './pinterest.service';
import { ThreadsService } from './threads.service';
import { XService } from './x.service';

@Injectable()
export class PlatformOAuthService {
  private readonly logger = new Logger(PlatformOAuthService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly googleService: GoogleService,
    private readonly pinterestService: PinterestService,
    private readonly metaService: MetaService,
    private readonly threadsService: ThreadsService,
    private readonly xService: XService,
  ) {}

  getRedirectUri(platform: ConnectPlatform): string {
    if (platform === 'google') {
      return this.googleService.getRedirectUri();
    }
    if (platform === 'pinterest') {
      return this.pinterestService.getRedirectUri();
    }
    if (platform === 'meta') {
      return this.metaService.getRedirectUri();
    }
    if (platform === 'thread') {
      return this.threadsService.getRedirectUri();
    }
    if (platform === 'x') {
      return this.xService.getRedirectUri();
    }

    const appUrl = this.configService
      .getOrThrow<string>('APP_URL')
      .replace(/\/$/, '');

    const envMap: Record<ConnectPlatform, string> = {
      google: 'GOOGLE_REDIRECT_URI',
      meta: 'META_REDIRECT_URI',
      thread: 'THREAD_REDIRECT_URI',
      x: 'X_REDIRECT_URI',
      linkedin: 'LINKEDIN_REDIRECT_URI',
      pinterest: 'PINTEREST_REDIRECT_URI',
      tiktok: 'TIKTOK_REDIRECT_URI',
    };

    return (
      this.configService.get<string>(envMap[platform]) ??
      `${appUrl}/oauth/${platform}/callback`
    );
  }

  async getAccessToken(
    platform: ConnectPlatform,
    code: string,
    options?: { codeVerifier?: string },
  ): Promise<OAuthTokenResult> {
    switch (platform) {
      case 'google':
        return this.googleService.getAccessToken(code);
      case 'meta':
        return this.metaService.getAccessToken(code);
      case 'thread':
        return this.threadsService.getAccessToken(code);
      case 'x': {
        if (!options?.codeVerifier) {
          throw new BadRequestException('Missing X PKCE code verifier');
        }
        return this.xService.getAccessToken(code, options.codeVerifier);
      }
      case 'linkedin':
        return this.getLinkedinAccessToken(code);
      case 'pinterest':
        return this.pinterestService.getAccessToken(code);
      case 'tiktok':
        return this.getTiktokAccessToken(code);
    }
  }

  async getProfileInfo(
    platform: ConnectPlatform,
    accessToken: string,
  ): Promise<OAuthProfileInfo> {
    switch (platform) {
      case 'google': {
        const data = await this.googleService.collectConnectData(accessToken);
        return { ...data.profile, metadata: data.metadata };
      }
      case 'meta': {
        const data = await this.metaService.collectConnectData(accessToken);
        return { ...data.profile, metadata: data.metadata };
      }
      case 'thread': {
        const data = await this.threadsService.collectConnectData(accessToken);
        return { ...data.profile, metadata: data.metadata };
      }
      case 'x': {
        const data = await this.xService.collectConnectData(accessToken);
        return { ...data.profile, metadata: data.metadata };
      }
      case 'linkedin':
        return this.getLinkedinProfile(accessToken);
      case 'pinterest': {
        const data = await this.pinterestService.collectConnectData(accessToken);
        return { ...data.profile, metadata: data.metadata };
      }
      case 'tiktok':
        return this.getTiktokProfile(accessToken);
    }
  }

  async refreshGoogleToken(refreshToken: string): Promise<OAuthTokenResult> {
    return this.googleService.refreshToken(refreshToken);
  }

  private async getLinkedinAccessToken(code: string): Promise<OAuthTokenResult> {
    this.requireEnv(['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.getRedirectUri('linkedin'),
      client_id: this.configService.getOrThrow<string>('LINKEDIN_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>(
        'LINKEDIN_CLIENT_SECRET',
      ),
    });

    const { data } = await this.postForm(
      'https://www.linkedin.com/oauth/v2/accessToken',
      body,
    );

    return this.mapTokenResponse(data);
  }

  private async getLinkedinProfile(
    accessToken: string,
  ): Promise<OAuthProfileInfo> {
    const { data } = await firstValueFrom(
      this.httpService.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    return {
      platformUserId: String(data.sub),
      username: data.email ?? data.name ?? String(data.sub),
      displayName: data.name ?? null,
      profileImage: data.picture ?? null,
      email: data.email ?? null,
      metadata: {
        email: data.email ?? null,
        providerProfile: data,
      },
    };
  }

  private async getTiktokAccessToken(code: string): Promise<OAuthTokenResult> {
    const clientKey =
      this.configService.get<string>('Tiktok_CLIENT_KEY') ??
      this.configService.getOrThrow<string>('TIKTOK_CLIENT_KEY');
    const clientSecret =
      this.configService.get<string>('Tiktok_CLIENT_SECRET') ??
      this.configService.getOrThrow<string>('TIKTOK_CLIENT_SECRET');
    const redirectUri =
      this.configService.get<string>('Tiktok_REDIRECT_URI') ??
      this.getRedirectUri('tiktok');

    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const { data } = await this.postForm(
      'https://open.tiktokapis.com/v2/oauth/token/',
      body,
    );

    const tokenData = data.data ?? data;
    return this.mapTokenResponse(tokenData);
  }

  private async getTiktokProfile(
    accessToken: string,
  ): Promise<OAuthProfileInfo> {
    const { data } = await firstValueFrom(
      this.httpService.get(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      ),
    );

    const user = data.data?.user ?? data.user ?? data;
    const platformUserId = String(user.open_id ?? user.union_id ?? user.username);

    return {
      platformUserId,
      username: user.username ?? user.display_name ?? platformUserId,
      displayName: user.display_name ?? null,
      profileImage: user.avatar_url ?? null,
      email: null,
      metadata: {
        providerProfile: user,
      },
    };
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(`OAuth token exchange failed: ${JSON.stringify(data)}`);
      throw new BadRequestException('Failed to obtain access token from provider');
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
      return await firstValueFrom(
        this.httpService.post(url, body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );
    } catch (error) {
      this.logger.error(
        `OAuth token request failed for ${url}: ${this.formatAxiosError(error)}`,
      );
      throw new BadRequestException('Failed to exchange authorization code');
    }
  }

  private requireEnv(keys: string[]): void {
    for (const key of keys) {
      if (!this.configService.get<string>(key)) {
        throw new NotImplementedException(
          `${key} is not configured for this platform`,
        );
      }
    }
  }

  private formatAxiosError(error: unknown): string {
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
