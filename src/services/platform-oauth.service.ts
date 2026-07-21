import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectPlatform } from '../connect/connect-platform.type';
import {
  OAuthProfileInfo,
  OAuthTokenResult,
} from '../connect/types/oauth.types';
import { GoogleService } from './google.service';
import { LinkedInService } from './linkedin.service';
import { MetaService } from './meta.service';
import { PinterestService } from './pinterest.service';
import { SnapchatService } from './snapchat.service';
import { ThreadsService } from './threads.service';
import { TikTokService } from './tiktok.service';
import { XService } from './x.service';

@Injectable()
export class PlatformOAuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly googleService: GoogleService,
    private readonly pinterestService: PinterestService,
    private readonly metaService: MetaService,
    private readonly threadsService: ThreadsService,
    private readonly xService: XService,
    private readonly linkedInService: LinkedInService,
    private readonly tiktokService: TikTokService,
    private readonly snapchatService: SnapchatService,
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
    if (platform === 'linkedin') {
      return this.linkedInService.getRedirectUri();
    }
    if (platform === 'tiktok') {
      return this.tiktokService.getRedirectUri();
    }
    if (platform === 'snapchat') {
      return this.snapchatService.getRedirectUri();
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
      snapchat: 'SNAPCHAT_REDIRECT_URI',
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
        return this.linkedInService.getAccessToken(code);
      case 'pinterest':
        return this.pinterestService.getAccessToken(code);
      case 'tiktok':
        return this.tiktokService.getAccessToken(code);
      case 'snapchat':
        return this.snapchatService.getAccessToken(code);
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
      case 'linkedin': {
        const data = await this.linkedInService.collectConnectData(accessToken);
        return { ...data.profile, metadata: data.metadata };
      }
      case 'pinterest': {
        const data = await this.pinterestService.collectConnectData(accessToken);
        return { ...data.profile, metadata: data.metadata };
      }
      case 'tiktok': {
        const data = await this.tiktokService.collectConnectData(accessToken);
        return { ...data.profile, metadata: data.metadata };
      }
      case 'snapchat': {
        const data = await this.snapchatService.collectConnectData(accessToken);
        return { ...data.profile, metadata: data.metadata };
      }
    }
  }

  async refreshGoogleToken(refreshToken: string): Promise<OAuthTokenResult> {
    return this.googleService.refreshToken(refreshToken);
  }
}
