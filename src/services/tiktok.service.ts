import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';

@Injectable()
export class TikTokService {
  private readonly logger = new Logger(TikTokService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
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

      const tokenData = (data as { data?: Record<string, unknown> }).data ?? data;
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
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username',
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
      user.open_id ?? user.union_id ?? user.username ?? 'unknown',
    );

    return {
      platformUserId,
      username: String(user.username ?? user.display_name ?? platformUserId),
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
