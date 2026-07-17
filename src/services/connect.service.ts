import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { OAuthCallbackQuery } from '../connect/dto/oauth-callback.dto';
import { ConnectPlatform } from '../connect/connect-platform.type';
import { OAuthStatePayload } from '../connect/types/oauth.types';
import { PlatformOAuthService } from './platform-oauth.service';
import { SocialAccountsService } from './social-accounts.service';

@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly platformOAuthService: PlatformOAuthService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  getAuthorizationUrl(platform: ConnectPlatform, userId: string) {
    switch (platform) {
      case 'google':
        return {
          platform,
          authorizationUrl: this.getGoogleAuthorizationUrl(userId),
        };
      case 'pinterest':
        return {
          platform,
          authorizationUrl: this.getPinterestAuthorizationUrl(userId),
        };
      default:
        throw new BadRequestException(
          `${platform} connection is not available yet`,
        );
    }
  }

  async handleCallback(platform: ConnectPlatform, query: OAuthCallbackQuery) {
    if (query.error) {
      this.logger.warn(
        `${platform} OAuth callback returned error: ${query.error} (${query.error_description ?? 'no description'})`,
      );
      throw new BadRequestException(
        `${platform} authorization failed: ${query.error_description ?? query.error}`,
      );
    }

    if (!query.code) {
      throw new BadRequestException(
        `${platform} authorization failed: missing code`,
      );
    }

    this.logger.log(
      `${platform} OAuth callback received (state=${query.state ?? 'none'})`,
    );

    return this.completeOAuthConnect(platform, query.code, query.state);
  }

  private async completeOAuthConnect(
    platform: ConnectPlatform,
    code: string,
    state?: string,
  ) {
    const userId = this.verifyState(state, platform);
    const token = await this.platformOAuthService.getAccessToken(
      platform,
      code,
    );
    const profile = await this.platformOAuthService.getProfileInfo(
      platform,
      token.accessToken,
    );
    const account = await this.socialAccountsService.upsertFromOAuth(
      userId,
      platform,
      token,
      profile,
    );

    return {
      message: `${platform} account connected successfully`,
      account,
    };
  }

  private verifyState(
    state: string | undefined,
    platform: ConnectPlatform,
  ): string {
    if (!state) {
      throw new BadRequestException('Missing OAuth state');
    }

    let payload: OAuthStatePayload;
    try {
      payload = this.jwtService.verify<OAuthStatePayload>(state);
    } catch {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }

    if (
      payload.purpose !== 'social-connect' ||
      payload.platform !== platform
    ) {
      throw new BadRequestException('Invalid OAuth state');
    }

    return payload.sub;
  }

  private signState(platform: ConnectPlatform, userId: string): string {
    return this.jwtService.sign(
      {
        sub: userId,
        platform,
        purpose: 'social-connect',
        nonce: randomUUID(),
      },
      { expiresIn: '10m' },
    );
  }

  private getGoogleAuthorizationUrl(userId: string): string {
    const clientId = this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.platformOAuthService.getRedirectUri('google');
    const scopes = (
      this.configService.get<string>('GOOGLE_SCOPES') ??
      'openid email profile'
    )
      .split(/[\s,]+/)
      .filter(Boolean);
    const state = this.signState('google', userId);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  private getPinterestAuthorizationUrl(userId: string): string {
    const clientId = this.configService.getOrThrow<string>('PINTEREST_APP_ID');
    const redirectUri = this.platformOAuthService.getRedirectUri('pinterest');
    const scopes = (
      this.configService.get<string>('PINTEREST_SCOPES') ??
      'boards:read pins:read user_accounts:read'
    )
      .split(/[\s,]+/)
      .filter(Boolean);
    const state = this.signState('pinterest', userId);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
    });

    return `https://www.pinterest.com/oauth/?${params.toString()}`;
  }
}
