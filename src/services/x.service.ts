import { createHash, randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SocialAccountsService } from './social-accounts.service';

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
      'tweet.read users.read offline.access';

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
      'https://api.twitter.com/2/users/me?user.fields=id,name,username,profile_image_url,description,public_metrics,verified,created_at',
      accessToken,
    );

    const user = data.data ?? data;

    return {
      platformUserId: String(user.id),
      username: user.username ?? String(user.id),
      displayName: user.name ?? user.username ?? null,
      profileImage: user.profile_image_url ?? null,
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
      this.logger.error(`X API failed (${url}): ${this.formatError(error)}`);
      throw new BadRequestException('X API request failed');
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
