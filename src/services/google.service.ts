import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  getRedirectUri(): string {
    return (
      this.configService.get<string>('GOOGLE_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/google/callback`
    );
  }

  async getAccessToken(code: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      code,
      client_id: this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      redirect_uri: this.getRedirectUri(),
      grant_type: 'authorization_code',
    });

    const data = await this.postForm('https://oauth2.googleapis.com/token', body);
    return this.mapTokenResponse(data);
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    });

    const data = await this.postForm('https://oauth2.googleapis.com/token', body);
    return this.mapTokenResponse(data);
  }

  async getUserProfile(accessToken: string) {
    const { data } = await this.request(
      'GET',
      'https://www.googleapis.com/oauth2/v2/userinfo',
      accessToken,
    );

    return {
      platformUserId: String(data.id),
      username: data.email ?? data.name ?? String(data.id),
      displayName: data.name ?? null,
      profileImage: data.picture ?? null,
      email: data.email ?? null,
      raw: data,
    };
  }

  async getAccount(accessToken: string) {
    const { data } = await this.request(
      'GET',
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      accessToken,
    );

    return data;
  }

  async getLocation(accessToken: string, accountName: string) {
    const { data } = await this.request(
      'GET',
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`,
      accessToken,
    );

    return data;
  }

  async getBusinessProfile(accessToken: string, locationName: string) {
    const { data } = await this.request(
      'GET',
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}`,
      accessToken,
    );

    return data;
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);

    let account: unknown = null;
    let locations: unknown = null;
    let businessProfile: unknown = null;

    try {
      account = await this.getAccount(accessToken);
      const accountName = (account as { accounts?: { name?: string }[] })
        ?.accounts?.[0]?.name;

      if (accountName) {
        locations = await this.getLocation(accessToken, accountName);
        const locationName = (locations as { locations?: { name?: string }[] })
          ?.locations?.[0]?.name;

        if (locationName) {
          businessProfile = await this.getBusinessProfile(
            accessToken,
            locationName,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Google business data fetch skipped: ${this.formatError(error)}`,
      );
    }

    return {
      profile,
      metadata: {
        email: profile.email,
        googleAccount: account,
        locations,
        businessProfile,
      },
    };
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(`Google token exchange failed: ${JSON.stringify(data)}`);
      throw new BadRequestException('Failed to obtain Google access token');
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
      const { data } = await firstValueFrom(
        this.httpService.post(url, body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
        }),
      );
      return data as Record<string, unknown>;
    } catch (error) {
      this.logger.error(
        `Google token request failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException('Failed to exchange Google authorization code');
    }
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
      this.logger.error(`Google API request failed (${url}): ${this.formatError(error)}`);
      throw new BadRequestException('Google API request failed');
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
