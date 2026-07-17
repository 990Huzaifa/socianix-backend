import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { OAuthCallbackQuery } from '../connect/dto/oauth-callback.dto';
import { ConnectPlatform } from '../connect/connect-platform.type';

@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
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

    this.logger.log(`${platform} OAuth callback received (state=${query.state ?? 'none'})`);

    switch (platform) {
      case 'google':
        return this.handleGoogleCallback(query.code, query.state);
      case 'meta':
        return this.handleMetaCallback(query.code, query.state);
      case 'linkedin':
        return this.handleLinkedinCallback(query.code, query.state);
      case 'pinterest':
        return this.handlePinterestCallback(query.code, query.state);
      case 'tiktok':
        return this.handleTiktokCallback(query.code, query.state);
    }
  }

  private async handleGoogleCallback(code: string, state?: string) {
    // TODO: exchange code for tokens using GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET,
    // fetch profile, then upsert social account for the user resolved from state.
    return this.callbackAck('google', code, state);
  }

  private getGoogleAuthorizationUrl(userId: string): string {
    const clientId =
      this.configService.get<string>('GOOGLE_CLIENT_ID') ??
      this.configService.getOrThrow<string>('google_client_id');
    const redirectUri =
      this.configService.get<string>('GOOGLE_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/google/callback`;
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
    const redirectUri =
      this.configService.get<string>('PINTEREST_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/pinterest/callback`;
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

  private async handleMetaCallback(code: string, state?: string) {
    // TODO: exchange code for tokens using META_CLIENT_ID / META_CLIENT_SECRET.
    return this.callbackAck('meta', code, state);
  }

  private async handleLinkedinCallback(code: string, state?: string) {
    // TODO: exchange code for tokens using LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET.
    return this.callbackAck('linkedin', code, state);
  }

  private async handlePinterestCallback(code: string, state?: string) {
    // TODO: exchange code for tokens using PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET.
    return this.callbackAck('pinterest', code, state);
  }

  private async handleTiktokCallback(code: string, state?: string) {
    // TODO: exchange code for tokens using TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET.
    return this.callbackAck('tiktok', code, state);
  }

  private callbackAck(platform: ConnectPlatform, code: string, state?: string) {
    return {
      message: `${platform} callback received`,
      platform,
      code,
      state: state ?? null,
    };
  }
}
