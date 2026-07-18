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
import { SocialPlatform } from '../entities/social-platform.entity';

@Injectable()
export class SocialAccountsService {
  private readonly logger = new Logger(SocialAccountsService.name);

  constructor(
    @InjectRepository(SocialAccount)
    private readonly socialAccountsRepository: Repository<SocialAccount>,
    @InjectRepository(SocialPlatform)
    private readonly socialPlatformsRepository: Repository<SocialPlatform>,
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

    return account;
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

    return this.socialAccountsRepository.find({
      where: {
        platformId: platform.id,
        status: SocialAccountStatus.ACTIVE,
      },
    });
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
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? account.refreshToken,
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
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? account?.refreshToken ?? null,
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
    return account.accessToken;
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
}
