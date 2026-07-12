import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsNull, MoreThan, Repository } from 'typeorm';
import {
  PasswordResetToken,
  PasswordResetTokenType,
} from '../entities/password-reset-token.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class PasswordResetTokenService {
  private readonly logger = new Logger(PasswordResetTokenService.name);

  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
    private readonly configService: ConfigService,
  ) {}

  generateCode(): string {
    const length = Number(this.configService.get('OTP_LENGTH') ?? 6);
    const max = 10 ** length;
    return Math.floor(Math.random() * max)
      .toString()
      .padStart(length, '0');
  }

  getExpiryDate(): Date {
    const minutes = Number(
      this.configService.get('OTP_EXPIRES_IN_MINUTES') ?? 10,
    );
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  async invalidateActiveTokens(
    userId: string,
    type: PasswordResetTokenType,
  ): Promise<void> {
    await this.passwordResetTokenRepository.update(
      {
        userId,
        type,
        usedAt: IsNull(),
      },
      { usedAt: new Date() },
    );
  }

  async createToken(
    user: User,
    type: PasswordResetTokenType,
  ): Promise<string> {
    await this.invalidateActiveTokens(user.id, type);

    const code = this.generateCode();
    const codeHash = await bcrypt.hash(code, 10);

    const token = this.passwordResetTokenRepository.create({
      userId: user.id,
      codeHash,
      type,
      expiresAt: this.getExpiryDate(),
    });
    await this.passwordResetTokenRepository.save(token);

    if (this.configService.get('NODE_ENV') !== 'production') {
      this.logger.debug(`Password reset token for ${user.email}: ${code}`);
    }

    return code;
  }

  async verifyToken(
    userId: string,
    code: string,
    type: PasswordResetTokenType,
  ): Promise<PasswordResetToken> {
    const token = await this.passwordResetTokenRepository.findOne({
      where: {
        userId,
        type,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    if (!token) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const isValid = await bcrypt.compare(code, token.codeHash);
    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    return token;
  }

  async markUsed(token: PasswordResetToken): Promise<void> {
    token.usedAt = new Date();
    await this.passwordResetTokenRepository.save(token);
  }
}
