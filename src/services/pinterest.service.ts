import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';

@Injectable()
export class PinterestService {
  private readonly logger = new Logger(PinterestService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  getRedirectUri(): string {
    return (
      this.configService.get<string>('PINTEREST_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/pinterest/callback`
    );
  }

  async getAccessToken(code: string): Promise<OAuthTokenResult> {
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
      redirect_uri: this.getRedirectUri(),
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://api.pinterest.com/v5/oauth/token',
          body.toString(),
          {
            headers: {
              Authorization: `Basic ${credentials}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 15000,
          },
        ),
      );

      return this.mapTokenResponse(data as Record<string, unknown>);
    } catch (error) {
      this.logger.error(
        `Pinterest token request failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException(
        'Failed to exchange Pinterest authorization code',
      );
    }
  }

  async getUserProfile(accessToken: string) {
    const { data } = await this.request(
      'GET',
      'https://api.pinterest.com/v5/user_account',
      accessToken,
    );

    return {
      platformUserId: String(data.username ?? data.id ?? data.account_type),
      username: data.username ?? String(data.id),
      displayName: data.username ?? null,
      profileImage: data.profile_image ?? null,
      email: null,
      raw: data,
    };
  }

  async getUserBoards(accessToken: string) {
    const { data } = await this.request(
      'GET',
      'https://api.pinterest.com/v5/boards',
      accessToken,
    );

    return data;
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);

    let boards: unknown = null;
    try {
      boards = await this.getUserBoards(accessToken);
    } catch (error) {
      this.logger.warn(
        `Pinterest boards fetch skipped: ${this.formatError(error)}`,
      );
    }

    return {
      profile,
      metadata: {
        profile: profile.raw,
        boards,
      },
    };
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(
        `Pinterest token exchange failed: ${JSON.stringify(data)}`,
      );
      throw new BadRequestException('Failed to obtain Pinterest access token');
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
          timeout: 15000,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Pinterest API request failed (${url}): ${this.formatError(error)}`,
      );
      throw new BadRequestException('Pinterest API request failed');
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
