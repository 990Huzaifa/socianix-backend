import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SocialAccountsService } from './social-accounts.service';

@Injectable()
export class PinterestService {
  private readonly logger = new Logger(PinterestService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly socialAccountsService: SocialAccountsService,
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

  async getUserBoards(
    accessToken: string,
    options?: { pageSize?: number; bookmark?: string },
  ) {
    const params = new URLSearchParams();
    params.set('page_size', String(options?.pageSize ?? 25));
    if (options?.bookmark) {
      params.set('bookmark', options.bookmark);
    }

    const { data } = await this.request(
      'GET',
      `https://api.pinterest.com/v5/boards?${params.toString()}`,
      accessToken,
    );

    return data;
  }

  async getBoard(accessToken: string, boardId: string) {
    const { data } = await this.request(
      'GET',
      `https://api.pinterest.com/v5/boards/${encodeURIComponent(boardId)}`,
      accessToken,
    );

    return data;
  }

  /**
   * Uses the stored Pinterest token for the user and returns boards list
   * with ids and full provider payloads.
   */
  async getBoardsForUser(
    userId: string,
    options?: { pageSize?: number; bookmark?: string },
  ) {
    const accessToken = await this.resolveAccessToken(userId);
    const boardsResponse = (await this.getUserBoards(accessToken, options)) as {
      items?: Array<{ id?: string; name?: string; [key: string]: unknown }>;
      bookmark?: string;
      [key: string]: unknown;
    };

    const items = boardsResponse.items ?? [];

    return {
      boards: items.map((board) => ({
        boardId: board.id ?? null,
        name: board.name ?? null,
        board,
      })),
      bookmark: boardsResponse.bookmark ?? null,
      raw: boardsResponse,
      total: items.length,
    };
  }

  async getBoardForUser(userId: string, boardId: string) {
    const accessToken = await this.resolveAccessToken(userId);
    const board = (await this.getBoard(accessToken, boardId)) as {
      id?: string;
      name?: string;
      [key: string]: unknown;
    };

    return {
      boardId: board.id ?? boardId,
      name: board.name ?? null,
      board,
    };
  }

  /**
   * Create a Pin on a board via POST /v5/pins.
   * Image pins use public S3 URLs (image_url / multiple_image_urls).
   */
  async createPin(
    accessToken: string,
    input: {
      boardId: string;
      title?: string | null;
      description?: string | null;
      link?: string | null;
      altText?: string | null;
      imageUrls: string[];
    },
  ) {
    const boardId = input.boardId?.trim();
    if (!boardId) {
      throw new BadRequestException('Pinterest boardId is required');
    }

    const imageUrls = (input.imageUrls ?? [])
      .map((url) => url?.trim())
      .filter(Boolean);

    if (!imageUrls.length) {
      throw new BadRequestException(
        'Pinterest pin requires at least one public image URL',
      );
    }

    const media_source =
      imageUrls.length === 1
        ? {
            source_type: 'image_url',
            url: imageUrls[0],
          }
        : {
            source_type: 'multiple_image_urls',
            items: imageUrls.slice(0, 5).map((url) => ({ url })),
          };

    const body: Record<string, unknown> = {
      board_id: boardId,
      media_source,
    };

    if (input.title?.trim()) {
      body.title = input.title.trim().slice(0, 100);
    }
    if (input.description?.trim()) {
      body.description = input.description.trim().slice(0, 800);
    }
    if (input.link?.trim()) {
      body.link = input.link.trim().slice(0, 2048);
    }
    if (input.altText?.trim()) {
      body.alt_text = input.altText.trim().slice(0, 500);
    }

    const { data } = await this.request(
      'POST',
      'https://api.pinterest.com/v5/pins',
      accessToken,
      body,
    );

    const pin = data as {
      id?: string;
      [key: string]: unknown;
    };

    this.logger.log(
      `Created Pinterest pin boardId=${boardId} pinId=${pin.id ?? 'unknown'}`,
    );

    return {
      pinId: pin.id ?? null,
      pin,
    };
  }

  async createPinForUser(
    userId: string,
    input: {
      boardId: string;
      title?: string | null;
      description?: string | null;
      link?: string | null;
      altText?: string | null;
      imageUrls: string[];
    },
  ) {
    const accessToken = await this.resolveAccessToken(userId);
    return this.createPin(accessToken, input);
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

  private async resolveAccessToken(userId: string): Promise<string> {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'pinterest',
      );
    return this.socialAccountsService.assertHasAccessToken(account);
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
          timeout: 20000,
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
