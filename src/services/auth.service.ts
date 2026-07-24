import {
  BadRequestException,
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
import { VerifyEmailDto } from '../auth/dto/verify-email.dto';
import { SocialLoginDto } from '../auth/dto/social-login.dto';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { MailService } from './mail.service';
import { PasswordResetTokenService } from './password-reset-token.service';
import { SocialTokenVerifierService } from './social-token-verifier.service';
import { UserAuthProviderService } from './user-auth-provider.service';
import { UsersService } from './users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly passwordResetTokenService: PasswordResetTokenService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly socialTokenVerifier: SocialTokenVerifierService,
    private readonly userAuthProviderService: UserAuthProviderService,
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

    const code = await this.passwordResetTokenService.createToken(
      user,
      PasswordResetTokenType.EMAIL_VERIFICATION,
    );
    await this.mailService.sendEmailVerification(user.email, user.name, code);

    const response: {
      message: string;
      email: string;
      otp?: string;
    } = {
      message:
        'Registration successful. Please verify your email with the OTP sent to your inbox.',
      email: user.email,
    };

    if (this.configService.get('NODE_ENV') !== 'production') {
      response.otp = code;
    }

    return response;
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    const token = await this.passwordResetTokenService.verifyToken(
      user.id,
      dto.otp,
      PasswordResetTokenType.EMAIL_VERIFICATION,
    );

    const verifiedUser = await this.usersService.markEmailVerified(user.id);
    await this.passwordResetTokenService.markUsed(token);
    await this.passwordResetTokenService.invalidateActiveTokens(
      user.id,
      PasswordResetTokenType.EMAIL_VERIFICATION,
    );

    await this.mailService.sendWelcome(verifiedUser.email, verifiedUser.name);

    return this.buildAuthResponse(verifiedUser);
  }

  async resendVerification(dto: ResendOtpDto) {
    const genericMessage =
      'If an unverified account exists for this email, a new verification OTP has been sent';

    const user = await this.usersService.findByEmail(dto.email);
    if (!user || user.isEmailVerified) {
      return { message: genericMessage };
    }

    const code = await this.passwordResetTokenService.createToken(
      user,
      PasswordResetTokenType.EMAIL_VERIFICATION,
    );
    await this.mailService.sendEmailVerification(user.email, user.name, code);

    const response: { message: string; otp?: string } = {
      message: genericMessage,
    };

    if (this.configService.get('NODE_ENV') !== 'production') {
      response.otp = code;
    }

    return response;
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.password) {
      throw new UnauthorizedException(
        'This account uses social login. Sign in with Google or Apple.',
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException(
        'Please verify your email before logging in',
      );
    }

    return this.buildAuthResponse(user);
  }

  async socialLogin(dto: SocialLoginDto) {
    const profile = await this.socialTokenVerifier.verify(
      dto.provider,
      dto.idToken,
    );

    let user = await this.userAuthProviderService.findUserByProvider(
      dto.provider,
      profile.providerUserId,
    );
    let isNewUser = false;

    if (!user) {
      const loginProfile =
        this.socialTokenVerifier.requireLoginProfile(profile);

      const existing = await this.usersService.findByEmail(loginProfile.email);
      if (existing) {
        await this.userAuthProviderService.linkToUser(
          existing,
          dto.provider,
          profile,
        );
        user = existing;
      } else {
        user = await this.usersService.createSocialUser({
          name: loginProfile.name,
          email: loginProfile.email,
          timezone: dto.timezone,
          phone: dto.phone,
          avatar: dto.avatar ?? loginProfile.avatar ?? null,
          deviceId: dto.deviceId,
          fcmToken: dto.fcmToken,
          ip: dto.ip,
          appVersion: dto.appVersion,
        });
        await this.userAuthProviderService.create(user.id, dto.provider, profile);
        isNewUser = true;
      }
    }

    if (dto.deviceId || dto.fcmToken || dto.appVersion) {
      user = await this.usersService.updateProfile(user.id, {
        ...(dto.deviceId !== undefined && { deviceId: dto.deviceId }),
        ...(dto.fcmToken !== undefined && { fcmToken: dto.fcmToken }),
        ...(dto.appVersion !== undefined && { appVersion: dto.appVersion }),
      });
    }

    if (isNewUser) {
      await this.mailService.sendWelcome(user.email, user.name);
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
    await this.mailService.sendPasswordResetOtp(user.email, user.name, code);

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
    const response = plainToInstance(UserResponseDto, user, {
      excludeExtraneousValues: true,
    });

    if (user.wallet) {
      response.wallet = {
        id: user.wallet.id,
        credits: user.wallet.credits,
        freeCredits: user.wallet.freeCredits,
      };
    } else {
      response.wallet = null;
    }

    return response;
  }
}
