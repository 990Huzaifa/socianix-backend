import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SocialAuthProvider,
  UserAuthProvider,
} from '../entities/user-auth-provider.entity';
import { User } from '../entities/user.entity';
import { SocialProfile } from '../auth/types/social-profile.type';

@Injectable()
export class UserAuthProviderService {
  constructor(
    @InjectRepository(UserAuthProvider)
    private readonly userAuthProviderRepository: Repository<UserAuthProvider>,
  ) {}

  async findUserByProvider(
    provider: SocialAuthProvider,
    providerUserId: string,
  ): Promise<User | null> {
    const link = await this.userAuthProviderRepository.findOne({
      where: { provider, providerUserId },
      relations: ['user'],
    });

    return link?.user ?? null;
  }

  async create(
    userId: string,
    provider: SocialAuthProvider,
    profile: SocialProfile,
  ): Promise<UserAuthProvider> {
    try {
      const link = this.userAuthProviderRepository.create({
        userId,
        provider,
        providerUserId: profile.providerUserId,
        providerEmail: profile.email ?? null,
      });

      return await this.userAuthProviderRepository.save(link);
    } catch {
      throw new ConflictException(
        'This social account is already linked to another user',
      );
    }
  }

  async linkToUser(
    user: User,
    provider: SocialAuthProvider,
    profile: SocialProfile,
  ): Promise<UserAuthProvider> {
    const existing = await this.userAuthProviderRepository.findOne({
      where: { userId: user.id, provider },
    });

    if (existing) {
      if (existing.providerUserId !== profile.providerUserId) {
        throw new ConflictException(
          `This account is already linked to a different ${provider} account`,
        );
      }

      return existing;
    }

    return this.create(user.id, provider, profile);
  }
}
