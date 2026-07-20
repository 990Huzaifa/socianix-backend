import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import { SocialAuthProvider } from '../entities/user-auth-provider.entity';
import { User } from '../entities/user.entity';
import {
  SocialLoginProfile,
  SocialProfile,
} from '../auth/types/social-profile.type';

@Injectable()
export class SocialTokenVerifierService {
  private readonly googleClient: OAuth2Client;
  private readonly googleClientIds: string[];
  private readonly appleClientId: string;

  constructor(private readonly configService: ConfigService) {
    this.googleClientIds = this.parseGoogleClientIds();
    this.googleClient = new OAuth2Client();
    this.appleClientId = this.configService.getOrThrow<string>(
      'APPLE_AUTH_CLIENT_ID',
    );
  }

  async verify(
    provider: SocialAuthProvider,
    idToken: string,
  ): Promise<SocialProfile> {
    if (provider === SocialAuthProvider.GOOGLE) {
      return this.verifyGoogle(idToken);
    }

    if (provider === SocialAuthProvider.APPLE) {
      return this.verifyApple(idToken);
    }

    throw new UnauthorizedException('Unsupported social login provider');
  }

  requireLoginProfile(profile: SocialProfile): SocialLoginProfile {
    if (!profile.email?.trim()) {
      throw new UnauthorizedException(
        'Email is required for first-time social login',
      );
    }

    const name = profile.name?.trim() || profile.email.split('@')[0];

    return {
      ...profile,
      email: profile.email.trim(),
      name,
    };
  }

  private async verifyGoogle(idToken: string): Promise<SocialProfile> {
    if (this.googleClientIds.length === 0) {
      throw new UnauthorizedException('Google social login is not configured');
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleClientIds,
      });
      const payload = ticket.getPayload();

      if (!payload?.sub) {
        throw new UnauthorizedException('Invalid Google token');
      }

      if (payload.email_verified !== true) {
        throw new UnauthorizedException('Google email is not verified');
      }

      return {
        providerUserId: payload.sub,
        email: payload.email ?? null,
        name: payload.name ?? null,
        avatar: payload.picture ?? null,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid or expired Google token');
    }
  }

  private async verifyApple(idToken: string): Promise<SocialProfile> {
    try {
      const payload = await appleSignin.verifyIdToken(idToken, {
        audience: this.appleClientId,
        ignoreExpiration: false,
      });

      if (!payload.sub) {
        throw new UnauthorizedException('Invalid Apple token');
      }

      return {
        providerUserId: payload.sub,
        email: payload.email ?? null,
        name: null,
        avatar: null,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid or expired Apple token');
    }
  }

  private parseGoogleClientIds(): string[] {
    const raw =
      this.configService.get<string>('GOOGLE_AUTH_CLIENT_IDS') ??
      this.configService.get<string>('GOOGLE_CLIENT_ID') ??
      '';

    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
}
