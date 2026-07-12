import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { plainToInstance } from 'class-transformer';
import { PasswordResetTokenType } from '../entities/password-reset-token.entity';
import { User } from '../entities/user.entity';
import { ForgotPasswordDto } from '../auth/dto/forgot-password.dto';
import { LoginDto } from '../auth/dto/login.dto';
import { RegisterDto } from '../auth/dto/register.dto';
import { ResendOtpDto } from '../auth/dto/resend-otp.dto';
import { ResetPasswordDto } from '../auth/dto/reset-password.dto';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { MailService } from './mail.service';
import { PasswordResetTokenService } from './password-reset-token.service';
import { UsersService } from './users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly passwordResetTokenService: PasswordResetTokenService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.create({
      ...dto,
      password: hashedPassword,
    });

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.buildAuthResponse(user);
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findByIdOrFail(userId);
    return this.toUserResponse(user);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    return this.issuePasswordResetToken(dto.email);
  }

  async resendOtp(dto: ResendOtpDto) {
    return this.issuePasswordResetToken(dto.email, true);
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    const token = await this.passwordResetTokenService.verifyToken(
      user.id,
      dto.otp,
      PasswordResetTokenType.FORGOT_PASSWORD,
    );

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.usersService.updatePassword(user.id, hashedPassword);
    await this.passwordResetTokenService.markUsed(token);
    await this.passwordResetTokenService.invalidateActiveTokens(
      user.id,
      PasswordResetTokenType.FORGOT_PASSWORD,
    );

    return {
      message: 'Password reset successfully',
    };
  }

  private async issuePasswordResetToken(email: string, isResend = false) {
    const genericMessage = isResend
      ? 'If an account exists for this email, a new OTP has been sent'
      : 'If an account exists for this email, an OTP has been sent';

    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return { message: genericMessage };
    }

    const code = await this.passwordResetTokenService.createToken(
      user,
      PasswordResetTokenType.FORGOT_PASSWORD,
    );
    await this.mailService.sendPasswordResetOtp(user.email, code);

    const response: { message: string; otp?: string } = {
      message: genericMessage,
    };

    if (this.configService.get('NODE_ENV') !== 'production') {
      response.otp = code;
    }

    return response;
  }

  private buildAuthResponse(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: this.toUserResponse(user),
    };
  }

  private toUserResponse(user: User): UserResponseDto {
    return plainToInstance(UserResponseDto, user, {
      excludeExtraneousValues: true,
    });
  }
}
