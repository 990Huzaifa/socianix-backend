import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenResult } from '../connect/types/oauth.types';
import { SocialAccountsService } from './social-accounts.service';

export type CreateLinkedInPostInput = {
  commentary?: string | null;
  /** Public image URL(s). One → single media; 2+ → multiImage. */
  imageUrls?: string[];
  /** Optional article/link share URL. */
  link?: string | null;
  linkTitle?: string | null;
  linkDescription?: string | null;
};

@Injectable()
export class LinkedInService {
  private readonly logger = new Logger(LinkedInService.name);
  private readonly apiVersion = '202502';
  private readonly restBase = 'https://api.linkedin.com/rest';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  getClientId(): string {
    return this.configService.getOrThrow<string>('LINKEDIN_CLIENT_ID');
  }

  getClientSecret(): string {
    return this.configService.getOrThrow<string>('LINKEDIN_CLIENT_SECRET');
  }

  getRedirectUri(): string {
    return (
      this.configService.get<string>('LINKEDIN_REDIRECT_URI') ??
      `${this.configService.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/oauth/linkedin/callback`
    );
  }

  getScopes(): string[] {
    const raw =
      this.configService.get<string>('LINKEDIN_SCOPES') ??
      'openid profile email w_member_social w_organization_social r_organization_social offline_access';

    return raw.split(/[\s,]+/).filter(Boolean);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.getClientId(),
      redirect_uri: this.getRedirectUri(),
      scope: this.getScopes().join(' '),
      state,
    });

    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
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
          'https://www.linkedin.com/oauth/v2/accessToken',
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
        `LinkedIn token exchange failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException(
        'Failed to exchange LinkedIn authorization code',
      );
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
    });

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://www.linkedin.com/oauth/v2/accessToken',
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
        `LinkedIn refresh token failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException('Failed to refresh LinkedIn access token');
    }
  }

  async getUserProfile(accessToken: string) {
    const { data } = await this.request(
      'GET',
      'https://api.linkedin.com/v2/userinfo',
      accessToken,
      undefined,
      false,
    );

    return {
      platformUserId: String(data.sub),
      username: data.email ?? data.name ?? String(data.sub),
      displayName: data.name ?? null,
      profileImage: data.picture ?? null,
      email: data.email ?? null,
      raw: data,
    };
  }

  async getOrganizations(accessToken: string) {
    const { data } = await this.request(
      'GET',
      `${this.restBase}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100`,
      accessToken,
    );

    return data;
  }

  /**
   * Uses the stored LinkedIn token and returns organizations the member can administer.
   */
  async getOrganizationsForUser(userId: string) {
    const accessToken = await this.resolveAccessToken(userId);
    const orgsResponse = (await this.getOrganizations(accessToken)) as {
      elements?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };

    const elements = orgsResponse.elements ?? [];

    return {
      organizations: elements.map((element) => {
        const org =
          (element.organization as string | undefined) ??
          (element['organization~'] as Record<string, unknown> | undefined);
        const organizationId =
          typeof org === 'string'
            ? this.extractIdFromUrn(org)
            : org && typeof org === 'object'
              ? String(
                  (org as { id?: string | number }).id ??
                    this.extractIdFromUrn(
                      String((org as { organization?: string }).organization ?? ''),
                    ),
                )
              : null;

        const localized =
          typeof org === 'object' && org
            ? ((org as { localizedName?: string }).localizedName ?? null)
            : null;

        return {
          organizationId,
          organizationUrn:
            typeof element.organization === 'string'
              ? element.organization
              : organizationId
                ? `urn:li:organization:${organizationId}`
                : null,
          role: element.role ?? null,
          state: element.state ?? null,
          name: localized,
          organization: element,
        };
      }),
      total: elements.length,
      raw: orgsResponse,
    };
  }

  async getProfileForUser(userId: string) {
    const accessToken = await this.resolveAccessToken(userId);
    const profile = await this.getUserProfile(accessToken);

    return {
      userId: profile.platformUserId,
      username: profile.username,
      displayName: profile.displayName,
      profileImage: profile.profileImage,
      email: profile.email,
      personUrn: `urn:li:person:${profile.platformUserId}`,
      raw: profile.raw,
    };
  }

  async collectConnectData(accessToken: string) {
    const profile = await this.getUserProfile(accessToken);

    let organizations: unknown = null;
    try {
      organizations = await this.getOrganizations(accessToken);
    } catch (error) {
      this.logger.warn(
        `LinkedIn organizations fetch skipped: ${this.formatError(error)}`,
      );
    }

    return {
      profile,
      metadata: {
        provider: 'linkedin',
        products: ['linkedin'],
        providerProfile: profile.raw,
        organizations,
      },
    };
  }

  /**
   * Post to the member's personal LinkedIn profile (`urn:li:person:{id}`).
   */
  async accountPost(
    accessToken: string,
    personId: string,
    input: CreateLinkedInPostInput,
  ) {
    const id = personId?.trim();
    if (!id) {
      throw new BadRequestException('LinkedIn person id is required');
    }

    return this.createPost(accessToken, `urn:li:person:${id}`, input);
  }

  /**
   * Post to a LinkedIn organization / company page (`urn:li:organization:{id}`).
   */
  async pagePost(
    accessToken: string,
    organizationId: string,
    input: CreateLinkedInPostInput,
  ) {
    const id = organizationId?.trim();
    if (!id) {
      throw new BadRequestException('LinkedIn organization id is required');
    }

    return this.createPost(accessToken, `urn:li:organization:${id}`, input);
  }

  async accountPostForUser(userId: string, input: CreateLinkedInPostInput) {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'linkedin',
      );
    const accessToken =
      this.socialAccountsService.assertHasAccessToken(account);

    return this.accountPost(accessToken, account.platformUserId, input);
  }

  async pagePostForUser(
    userId: string,
    organizationId: string,
    input: CreateLinkedInPostInput,
  ) {
    const accessToken = await this.resolveAccessToken(userId);
    return this.pagePost(accessToken, organizationId, input);
  }

  private async createPost(
    accessToken: string,
    authorUrn: string,
    input: CreateLinkedInPostInput,
  ) {
    const commentary = input.commentary?.trim() || undefined;
    const link = input.link?.trim() || undefined;
    const imageUrls = (input.imageUrls ?? [])
      .map((url) => url?.trim())
      .filter(Boolean) as string[];

    if (!commentary && !link && !imageUrls.length) {
      throw new BadRequestException(
        'LinkedIn post requires commentary, link, or imageUrls',
      );
    }

    const body: Record<string, unknown> = {
      author: authorUrn,
      commentary: commentary ?? '',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (imageUrls.length > 1) {
      const images: Array<{ id: string }> = [];
      for (const url of imageUrls.slice(0, 20)) {
        const imageUrn = await this.uploadImageFromUrl(
          accessToken,
          authorUrn,
          url,
        );
        images.push({ id: imageUrn });
      }
      body.content = { multiImage: { images } };
    } else if (imageUrls.length === 1) {
      const imageUrn = await this.uploadImageFromUrl(
        accessToken,
        authorUrn,
        imageUrls[0],
      );
      body.content = { media: { id: imageUrn } };
    } else if (link) {
      body.content = {
        article: {
          source: link,
          title: input.linkTitle?.trim() || commentary || link,
          description: input.linkDescription?.trim() || undefined,
        },
      };
    }

    const response = await this.request(
      'POST',
      `${this.restBase}/posts`,
      accessToken,
      body,
    );

    const postUrn =
      (response.headers?.['x-restli-id'] as string | undefined) ??
      (response.headers?.['x-linkedin-id'] as string | undefined) ??
      null;

    this.logger.log(
      `Published LinkedIn post author=${authorUrn} postUrn=${postUrn ?? 'unknown'}`,
    );

    return {
      postId: postUrn,
      postUrn,
      author: authorUrn,
      post: (response.data as Record<string, unknown>) ?? {},
    };
  }

  private async uploadImageFromUrl(
    accessToken: string,
    ownerUrn: string,
    imageUrl: string,
  ): Promise<string> {
    const imageBytes = await this.downloadBinary(imageUrl);

    const { data: initData } = await this.request(
      'POST',
      `${this.restBase}/images?action=initializeUpload`,
      accessToken,
      {
        initializeUploadRequest: {
          owner: ownerUrn,
        },
      },
    );

    const value = (initData as { value?: Record<string, unknown> }).value ?? initData;
    const uploadUrl = (value as { uploadUrl?: string }).uploadUrl;
    const imageUrn = (value as { image?: string }).image;

    if (!uploadUrl || !imageUrn) {
      throw new BadRequestException('Failed to initialize LinkedIn image upload');
    }

    try {
      await firstValueFrom(
        this.httpService.put(uploadUrl, imageBytes, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/octet-stream',
          },
          timeout: 60000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      );
    } catch (error) {
      this.logger.error(
        `LinkedIn image upload failed: ${this.formatError(error)}`,
      );
      throw new BadRequestException('Failed to upload LinkedIn image');
    }

    await this.waitForImageAvailable(accessToken, imageUrn);

    return imageUrn;
  }

  private async waitForImageAvailable(
    accessToken: string,
    imageUrn: string,
    maxAttempts = 12,
  ) {
    const encoded = encodeURIComponent(imageUrn);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { data } = await this.request(
        'GET',
        `${this.restBase}/images/${encoded}`,
        accessToken,
      );

      const status = (data as { status?: string }).status;
      if (status === 'AVAILABLE') {
        return;
      }
      if (status === 'PROCESSING_FAILED') {
        throw new BadRequestException('LinkedIn image processing failed');
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.logger.warn(
      `LinkedIn image ${imageUrn} not confirmed AVAILABLE; proceeding anyway`,
    );
  }

  private async downloadBinary(url: string): Promise<Buffer> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'arraybuffer',
          timeout: 60000,
        }),
      );
      return Buffer.from(data);
    } catch (error) {
      this.logger.error(
        `Failed to download media from ${url}: ${this.formatError(error)}`,
      );
      throw new BadRequestException('Failed to download media for LinkedIn upload');
    }
  }

  private async resolveAccessToken(userId: string): Promise<string> {
    const account =
      await this.socialAccountsService.findActiveByUserAndPlatform(
        userId,
        'linkedin',
      );
    return this.socialAccountsService.assertHasAccessToken(account);
  }

  private extractIdFromUrn(urn: string): string | null {
    if (!urn) {
      return null;
    }
    const parts = urn.split(':');
    return parts[parts.length - 1] || null;
  }

  private mapTokenResponse(data: Record<string, unknown>): OAuthTokenResult {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      this.logger.error(
        `LinkedIn token exchange failed: ${JSON.stringify(data)}`,
      );
      throw new BadRequestException('Failed to obtain LinkedIn access token');
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

  private restHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': this.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    };
  }

  private async request(
    method: 'GET' | 'POST',
    url: string,
    accessToken: string,
    payload?: unknown,
    useRestHeaders = true,
  ) {
    try {
      return await firstValueFrom(
        this.httpService.request({
          method,
          url,
          data: payload,
          headers: useRestHeaders
            ? this.restHeaders(accessToken)
            : { Authorization: `Bearer ${accessToken}` },
          timeout: 30000,
        }),
      );
    } catch (error) {
      this.logger.error(
        `LinkedIn API request failed (${url}): ${this.formatError(error)}`,
      );
      throw new BadRequestException('LinkedIn API request failed');
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
