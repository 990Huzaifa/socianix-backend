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

@Injectable()
export class PlatformOAuthService {
  private readonly logger = new Logger(PlatformOAuthService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  getRedirectUri(platform: ConnectPlatform): string {
    const appUrl = this.configService
      .getOrThrow<string>('APP_URL')
      .replace(/\/$/, '');

    const envMap: Record<ConnectPlatform, string> = {
      google: 'GOOGLE_REDIRECT_URI',
      meta: 'META_REDIRECT_URI',
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
  ): Promise<OAuthTokenResult> {
    switch (platform) {
      case 'google':
        return this.getGoogleAccessToken(code);
      case 'meta':
        return this.getMetaAccessToken(code);
      case 'linkedin':
        return this.getLinkedinAccessToken(code);
      case 'pinterest':
        return this.getPinterestAccessToken(code);
      case 'tiktok':
        return this.getTiktokAccessToken(code);
    }
  }

  async getProfileInfo(
    platform: ConnectPlatform,
    accessToken: string,
  ): Promise<OAuthProfileInfo> {
    switch (platform) {
      case 'google':
        return this.getGoogleProfile(accessToken);
      case 'meta':
        return this.getMetaProfile(accessToken);
      case 'linkedin':
        return this.getLinkedinProfile(accessToken);
      case 'pinterest':
        return this.getPinterestProfile(accessToken);
      case 'tiktok':
        return this.getTiktokProfile(accessToken);
    }
  }

  private async getGoogleAccessToken(code: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      code,
      client_id: this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>(
        'GOOGLE_CLIENT_SECRET',
      ),
      redirect_uri: this.getRedirectUri('google'),
      grant_type: 'authorization_code',
    });

    const { data } = await this.postForm(
      'https://oauth2.googleapis.com/token',
      body,
    );

    return this.mapTokenResponse(data);
  }

  private async getGoogleProfile(
    accessToken: string,
  ): Promise<OAuthProfileInfo> {
    const { data } = await firstValueFrom(
      this.httpService.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    return {
      platformUserId: String(data.id),
      username: data.email ?? data.name ?? String(data.id),
      displayName: data.name ?? null,
      profileImage: data.picture ?? null,
      email: data.email ?? null,
    };
  }

  private async getMetaAccessToken(code: string): Promise<OAuthTokenResult> {
    this.requireEnv(['META_APP_ID', 'META_APP_SECRET']);

    const params = new URLSearchParams({
      client_id: this.configService.getOrThrow<string>('META_APP_ID'),
      client_secret: this.configService.getOrThrow<string>('META_APP_SECRET'),
      redirect_uri: this.getRedirectUri('meta'),
      code,
    });

    const { data } = await firstValueFrom(
      this.httpService.get(
        `https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`,
      ),
    );

    return this.mapTokenResponse(data);
  }

  private async getMetaProfile(
    accessToken: string,
  ): Promise<OAuthProfileInfo> {
    const { data } = await firstValueFrom(
      this.httpService.get(
        'https://graph.facebook.com/me?fields=id,name,email,picture',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      ),
    );

    return {
      platformUserId: String(data.id),
      username: data.email ?? data.name ?? String(data.id),
      displayName: data.name ?? null,
      profileImage: data.picture?.data?.url ?? null,
      email: data.email ?? null,
    };
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
    };
  }

  private async getPinterestAccessToken(
    code: string,
  ): Promise<OAuthTokenResult> {
    const clientId = this.configService.getOrThrow<string>('PINTEREST_APP_ID');
    const clientSecret = this.configService.getOrThrow<string>(
      'PINTEREST_APP_SECRET',
    );
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    );

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.getRedirectUri('pinterest'),
    });

    const { data } = await firstValueFrom(
      this.httpService.post(
        'https://api.pinterest.com/v5/oauth/token',
        body.toString(),
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      ),
    );

    return this.mapTokenResponse(data);
  }

  private async getPinterestProfile(
    accessToken: string,
  ): Promise<OAuthProfileInfo> {
    const { data } = await firstValueFrom(
      this.httpService.get('https://api.pinterest.com/v5/user_account', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    return {
      platformUserId: String(data.username ?? data.id ?? data.account_type),
      username: data.username ?? String(data.id),
      displayName: data.username ?? null,
      profileImage: data.profile_image ?? null,
      email: null,
    };
  }

  private async getTiktokAccessToken(code: string): Promise<OAuthTokenResult> {
    this.requireEnv(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET']);

    const body = new URLSearchParams({
      client_key: this.configService.getOrThrow<string>('TIKTOK_CLIENT_KEY'),
      client_secret: this.configService.getOrThrow<string>(
        'TIKTOK_CLIENT_SECRET',
      ),
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.getRedirectUri('tiktok'),
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
