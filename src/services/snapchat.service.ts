import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';

@Injectable()
export class SnapchatService {
  private readonly logger = new Logger(SnapchatService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
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
    const raw =
      this.configService.get<string>('SNAPCHAT_SCOPES') ??
      'snapchat-marketing-api';

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

  async getUserProfile(accessToken: string) {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get('https://adsapi.snapchat.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 15000,
        }),
      );

      const me =
        (data as { me?: Record<string, unknown> }).me ??
        (data as Record<string, unknown>);
      const platformUserId = String(
        me.id ?? me.snapchat_user_id ?? me.organization_id ?? 'unknown',
      );

      return {
        platformUserId,
        username: String(
          me.username ?? me.display_name ?? me.name ?? platformUserId,
        ),
        displayName:
          typeof me.display_name === 'string'
            ? me.display_name
            : typeof me.name === 'string'
              ? me.name
              : null,
        profileImage:
          typeof me.profile_picture_url === 'string'
            ? me.profile_picture_url
            : null,
        email: typeof me.email === 'string' ? me.email : null,
        raw: me,
      };
    } catch (error) {
      this.logger.warn(
        `Snapchat profile fetch failed, using fallback identity: ${this.formatError(error)}`,
      );

      return {
        platformUserId: `snapchat:${accessToken.slice(0, 12)}`,
        username: 'snapchat-user',
        displayName: null,
        profileImage: null,
        email: null,
        raw: null,
      };
    }
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);

    return {
      profile,
      metadata: {
        provider: 'snapchat',
        products: ['snapchat'],
        providerProfile: profile.raw,
      },
    };
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
