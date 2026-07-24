import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { WalletService } from './wallet.service';

export type CreateUserData = {
  name: string;
  email: string;
  password: string;
  timezone: string;
  phone?: string;
  avatar?: string;
  deviceId?: string;
  fcmToken?: string;
  ip?: string;
  appVersion?: string;
};

export type CreateSocialUserData = {
  name: string;
  email: string;
  timezone: string;
  phone?: string;
  avatar?: string | null;
  deviceId?: string;
  fcmToken?: string;
  ip?: string;
  appVersion?: string;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly walletService: WalletService,
  ) {}

  async create(data: CreateUserData): Promise<User> {
    const user = await this.usersRepository.save(
      this.usersRepository.create({
        ...data,
        isEmailVerified: false,
      }),
    );
    await this.walletService.createForNewUser(user);
    return this.findByIdOrFail(user.id);
  }

  async createSocialUser(data: CreateSocialUserData): Promise<User> {
    const user = await this.usersRepository.save(
      this.usersRepository.create({
        ...data,
        password: null,
        isEmailVerified: true,
      }),
    );
    await this.walletService.createForNewUser(user);
    return this.findByIdOrFail(user.id);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email },
      relations: { wallet: true },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      relations: { wallet: true },
    });
  }

  async findByIdOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updatePassword(userId: string, hashedPassword: string): Promise<void> {
    await this.usersRepository.update(userId, { password: hashedPassword });
  }

  async markEmailVerified(userId: string): Promise<User> {
    await this.usersRepository.update(userId, { isEmailVerified: true });
    return this.findByIdOrFail(userId);
  }

  async updateProfile(
    userId: string,
    data: Partial<
      Pick<
        User,
        | 'name'
        | 'timezone'
        | 'phone'
        | 'avatar'
        | 'deviceId'
        | 'fcmToken'
        | 'appVersion'
      >
    >,
  ): Promise<User> {
    await this.usersRepository.update(userId, data);
    return this.findByIdOrFail(userId);
  }
}
