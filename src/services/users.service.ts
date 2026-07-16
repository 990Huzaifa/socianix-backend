import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

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

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(data: CreateUserData): Promise<User> {
    const user = this.usersRepository.create({
      ...data,
      isEmailVerified: false,
    });
    return this.usersRepository.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
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
}
