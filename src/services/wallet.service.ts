import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Wallet } from '../entities/wallet.entity';

/** Free credits granted when a new user registers (email or social). */
export const INITIAL_FREE_CREDITS = 10;

export type WalletDetails = {
  id: string;
  credits: number;
  freeCredits: number;
  totalCredits: number;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepository: Repository<Wallet>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /**
   * Create a wallet for a newly registered user and link it on the user row.
   * Safe to call once per user (skips if wallet already exists).
   */
  async createForNewUser(user: User): Promise<Wallet> {
    const existing = await this.findByUserId(user.id);
    if (existing) {
      return existing;
    }

    const wallet = await this.walletsRepository.save(
      this.walletsRepository.create({
        user: { id: user.id } as User,
        credits: 0,
        freeCredits: INITIAL_FREE_CREDITS,
      }),
    );

    await this.usersRepository
      .createQueryBuilder()
      .relation(User, 'wallet')
      .of(user.id)
      .set(wallet);

    this.logger.log(
      `Wallet created userId=${user.id} walletId=${wallet.id} freeCredits=${INITIAL_FREE_CREDITS}`,
    );

    return wallet;
  }

  async findByUserId(userId: string): Promise<Wallet | null> {
    return this.walletsRepository.findOne({
      where: { user: { id: userId } },
    });
  }

  /**
   * Return the authenticated user's wallet details.
   * Creates a wallet with starter free credits if missing (legacy users).
   */
  async getDetailsForUser(userId: string): Promise<WalletDetails> {
    let wallet = await this.findByUserId(userId);

    if (!wallet) {
      const user = await this.usersRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      wallet = await this.createForNewUser(user);
    }

    return {
      id: wallet.id,
      credits: wallet.credits,
      freeCredits: wallet.freeCredits,
      totalCredits: wallet.credits + wallet.freeCredits,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
}
