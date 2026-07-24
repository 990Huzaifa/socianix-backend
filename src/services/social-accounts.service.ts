import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectPlatform } from '../connect/connect-platform.type';
import {
  ConnectedAccountResponse,
  OAuthProfileInfo,
  OAuthTokenResult,
} from '../connect/types/oauth.types';
import {
  SocialAccount,
  SocialAccountStatus,
} from '../entities/social-account.entity';
import { SocialPlatform, SocialPlatformStatus } from '../entities/social-platform.entity';
import { SocialTokenCryptoService } from './social-token-crypto.service';

@Injectable()
export class SocialAccountsService {
  private readonly logger = new Logger(SocialAccountsService.name);

  constructor(
    @InjectRepository(SocialAccount)
    private readonly socialAccountsRepository: Repository<SocialAccount>,
    @InjectRepository(SocialPlatform)
    private readonly socialPlatformsRepository: Repository<SocialPlatform>,
    private readonly socialTokenCryptoService: SocialTokenCryptoService,
  ) {}

  async findActiveByUserAndPlatform(
    userId: string,
    platformSlug: ConnectPlatform,
  ): Promise<SocialAccount> {
    const platform = await this.socialPlatformsRepository.findOne({
      where: { slug: platformSlug },
    });

    if (!platform) {
      throw new NotFoundException(
        `Platform "${platformSlug}" is not seeded. Run npm run seed.`,
      );
    }

    const account = await this.socialAccountsRepository.findOne({
      where: {
        userId,
        platformId: platform.id,
        status: SocialAccountStatus.ACTIVE,
      },
    });

    if (!account) {
      throw new NotFoundException(
        `No connected ${platformSlug} account found. Connect the platform first.`,
      );
    }

    return this.withDecryptedTokens(account);
  }

  async findAllActiveByPlatform(
    platformSlug: ConnectPlatform,
  ): Promise<SocialAccount[]> {
    const platform = await this.socialPlatformsRepository.findOne({
      where: { slug: platformSlug },
    });

    if (!platform) {
      throw new NotFoundException(
        `Platform "${platformSlug}" is not seeded. Run npm run seed.`,
      );
    }

    const accounts = await this.socialAccountsRepository.find({
      where: {
        platformId: platform.id,
        status: SocialAccountStatus.ACTIVE,
      },
    });

    return accounts.map((account) => this.withDecryptedTokens(account));
  }

  /**
   * List all social platforms from DB with the user's connection status.
   */
  async listPlatforms(
    userId: string,
    options?: { status?: SocialPlatformStatus },
  ) {
    const platforms = await this.socialPlatformsRepository.find({
      where: options?.status ? { status: options.status } : undefined,
      order: { name: 'ASC' },
    });

    const activeAccounts = await this.socialAccountsRepository.find({
      where: { userId, status: SocialAccountStatus.ACTIVE },
      select: ['platformId'],
    });
    const connectedPlatformIds = new Set(
      activeAccounts.map((account) => account.platformId),
    );

    const items = platforms.map((platform) => ({
      id: platform.id,
      name: platform.name,
      slug: platform.slug,
      description: platform.description ?? null,
      icon: platform.icon ?? null,
      logo: platform.logo ?? null,
      status: platform.status,
      creditCost: platform.creditCost ?? 0,
      connected: connectedPlatformIds.has(platform.id),
      createdAt: platform.createdAt,
      updatedAt: platform.updatedAt,
    }));

    return {
      platforms: items,
      total: items.length,
    };
  }

  /**
   * List all social accounts for a user (active, disconnected, expired).
   * Tokens are never included in the response.
   */
  async listForUser(userId: string) {
    const accounts = await this.socialAccountsRepository.find({
      where: { userId },
      relations: { platform: true },
      order: { connectedAt: 'DESC' },
    });

    const items = accounts.map((account) => this.toListItem(account));

    const connected = items.filter(
      (item) => item.status === SocialAccountStatus.ACTIVE,
    );
    const disconnected = items.filter(
      (item) => item.status === SocialAccountStatus.DISCONNECTED,
    );
    const expired = items.filter(
      (item) => item.status === SocialAccountStatus.EXPIRED,
    );

    return {
      accounts: items,
      connected,
      disconnected,
      expired,
      total: items.length,
      counts: {
        active: connected.length,
        disconnected: disconnected.length,
        expired: expired.length,
      },
    };
  }

  private toListItem(account: SocialAccount) {
    return {
      id: account.id,
      platform: {
        id: account.platform?.id ?? account.platformId,
        name: account.platform?.name ?? null,
        slug: account.platform?.slug ?? null,
        icon: account.platform?.icon ?? null,
        logo: account.platform?.logo ?? null,
      },
      platformUserId: account.platformUserId,
      username: account.username,
      displayName: account.displayName ?? null,
      profileImage: account.profileImage ?? null,
      status: account.status,
      connectedAt: account.connectedAt,
      lastSyncedAt: account.lastSyncedAt ?? null,
      expiresAt: account.expiresAt ?? null,
      scopes: account.scopes ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  async updateTokens(
    accountId: string,
    token: OAuthTokenResult,
  ): Promise<SocialAccount> {
    const account = await this.socialAccountsRepository.findOne({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundException('Social account not found');
    }

    const expiresAt =
      token.expiresIn != null
        ? new Date(Date.now() + token.expiresIn * 1000)
        : account.expiresAt;

    return this.socialAccountsRepository.save({
      ...account,
      accessToken: this.socialTokenCryptoService.encrypt(token.accessToken),
      refreshToken:
        token.refreshToken != null
          ? this.socialTokenCryptoService.encrypt(token.refreshToken)
          : account.refreshToken,
      tokenType: token.tokenType ?? account.tokenType,
      expiresAt,
      scopes: token.scope
        ? token.scope.split(/[\s,]+/).filter(Boolean)
        : account.scopes,
      lastSyncedAt: new Date(),
      status: SocialAccountStatus.ACTIVE,
    });
  }

  async disconnectByUserAndPlatform(
    userId: string,
    platformSlug: ConnectPlatform,
  ) {
    const platform = await this.socialPlatformsRepository.findOne({
      where: { slug: platformSlug },
    });

    if (!platform) {
      throw new NotFoundException(
        `Platform "${platformSlug}" is not seeded. Run npm run seed.`,
      );
    }

    const account = await this.socialAccountsRepository.findOne({
      where: {
        userId,
        platformId: platform.id,
      },
    });

    if (!account) {
      throw new NotFoundException(
        `No connected ${platformSlug} account found for this user.`,
      );
    }

    // accessToken column is NOT NULL — clear with empty string.
    const updated = await this.socialAccountsRepository.save({
      ...account,
      accessToken: '',
      refreshToken: null,
      tokenType: null,
      expiresAt: null,
      scopes: null,
      status: SocialAccountStatus.DISCONNECTED,
      lastSyncedAt: new Date(),
    });

    this.logger.log(
      `Disconnected ${platformSlug} account ${updated.id} for user=${userId}`,
    );

    return {
      message: `${platformSlug} account disconnected successfully`,
      platform: platformSlug,
      accountId: updated.id,
      status: updated.status,
    };
  }

  async upsertFromOAuth(
    userId: string,
    platformSlug: ConnectPlatform,
    token: OAuthTokenResult,
    profile: OAuthProfileInfo,
  ): Promise<ConnectedAccountResponse> {
    const platform = await this.socialPlatformsRepository.findOne({
      where: { slug: platformSlug },
    });

    if (!platform) {
      throw new NotFoundException(
        `Platform "${platformSlug}" is not seeded. Run npm run seed.`,
      );
    }

    const scopes = token.scope
      ? token.scope.split(/[\s,]+/).filter(Boolean)
      : null;

    const expiresAt =
      token.expiresIn != null
        ? new Date(Date.now() + token.expiresIn * 1000)
        : null;

    let account = await this.socialAccountsRepository.findOne({
      where: { userId, platformId: platform.id },
    });

    if (!account) {
      account = await this.socialAccountsRepository.findOne({
        where: {
          userId,
          platformId: platform.id,
          platformUserId: profile.platformUserId,
        },
      });
    }

    const metadata = this.buildMetadata(profile);
    const accountData = {
      userId,
      platformId: platform.id,
      platformUserId: profile.platformUserId,
      username: profile.username,
      displayName: profile.displayName ?? null,
      profileImage: profile.profileImage ?? null,
      accessToken: this.socialTokenCryptoService.encrypt(token.accessToken),
      refreshToken:
        token.refreshToken != null
          ? this.socialTokenCryptoService.encrypt(token.refreshToken)
          : account?.refreshToken ?? null,
      tokenType: token.tokenType ?? account?.tokenType ?? null,
      expiresAt,
      scopes,
      metadata,
      status: SocialAccountStatus.ACTIVE,
      connectedAt: account?.connectedAt ?? new Date(),
      lastSyncedAt: new Date(),
    };

    if (account) {
      account = await this.socialAccountsRepository.save({
        ...account,
        ...accountData,
      });
      this.logger.log(
        `Updated social account ${account.id} for user=${userId} platform=${platformSlug}`,
      );
    } else {
      account = await this.socialAccountsRepository.save(
        this.socialAccountsRepository.create(accountData),
      );
      this.logger.log(
        `Created social account ${account.id} for user=${userId} platform=${platformSlug}`,
      );
    }

    return this.toConnectedResponse(platformSlug, account);
  }

  assertHasAccessToken(account: SocialAccount): string {
    if (!account.accessToken) {
      throw new UnauthorizedException('Stored access token is missing');
    }
    return this.socialTokenCryptoService.decrypt(account.accessToken) ?? '';
  }

  getRefreshToken(account: SocialAccount): string | null {
    return this.socialTokenCryptoService.decrypt(account.refreshToken) ?? null;
  }

  private buildMetadata(
    profile: OAuthProfileInfo,
  ): Record<string, unknown> | null {
    const metadata: Record<string, unknown> = {
      ...(profile.metadata ?? {}),
    };

    if (profile.email) {
      metadata.email = profile.email;
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  private toConnectedResponse(
    platform: ConnectPlatform,
    account: SocialAccount,
  ): ConnectedAccountResponse {
    return {
      id: account.id,
      platform,
      platformUserId: account.platformUserId,
      username: account.username,
      displayName: account.displayName ?? null,
      profileImage: account.profileImage ?? null,
      status: account.status,
      connectedAt: account.connectedAt,
    };
  }

  private withDecryptedTokens(account: SocialAccount): SocialAccount {
    account.accessToken =
      this.socialTokenCryptoService.decrypt(account.accessToken) ?? '';
    account.refreshToken =
      this.socialTokenCryptoService.decrypt(account.refreshToken) ?? null;
    return account;
  }
}
