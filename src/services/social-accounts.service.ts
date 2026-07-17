import { Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(
    @InjectRepository(SocialAccount)
    private readonly socialAccountsRepository: Repository<SocialAccount>,
    @InjectRepository(SocialPlatform)
    private readonly socialPlatformsRepository: Repository<SocialPlatform>,
  ) {}

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
      where: {
        userId,
        platformId: platform.id,
      },
    });

    const accountData = {
      userId,
      platformId: platform.id,
      platformUserId: profile.platformUserId,
      username: profile.username,
      displayName: profile.displayName ?? null,
      profileImage: profile.profileImage ?? null,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? null,
      tokenType: token.tokenType ?? null,
      expiresAt,
      scopes,
      metadata: profile.metadata ?? (profile.email ? { email: profile.email } : null),
      status: SocialAccountStatus.ACTIVE,
      connectedAt: account?.connectedAt ?? new Date(),
      lastSyncedAt: new Date(),
    };

    if (account) {
      account = await this.socialAccountsRepository.save({
        ...account,
        ...accountData,
      });
    } else {
      account = await this.socialAccountsRepository.save(
        this.socialAccountsRepository.create(accountData),
      );
    }

    return this.toConnectedResponse(platformSlug, account);
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
