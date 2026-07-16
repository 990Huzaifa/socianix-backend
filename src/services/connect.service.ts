import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { OAuthCallbackQuery } from '../connect/dto/oauth-callback.dto';
import { ConnectPlatform } from '../connect/connect-platform.type';

@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

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
