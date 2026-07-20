import {
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { SocialAuthProvider } from '../../entities/user-auth-provider.entity';

export class SocialLoginDto {
  @IsEnum(SocialAuthProvider)
  provider: SocialAuthProvider;

  @IsString()
  idToken: string;

  @IsString()
  timezone: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  fcmToken?: string;

  @IsOptional()
  @IsString()
  ip?: string;

  @IsOptional()
  @IsString()
  appVersion?: string;
}
