import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class UserResponseDto {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  email: string;

  @Expose()
  timezone: string;

  @Expose()
  phone?: string | null;

  @Expose()
  avatar?: string | null;

  @Expose()
  deviceId?: string | null;

  @Expose()
  fcmToken?: string | null;

  @Expose()
  ip?: string | null;

  @Expose()
  appVersion?: string | null;

  @Expose()
  isEmailVerified: boolean;

  @Expose()
  wallet?: {
    id: string;
    credits: number;
    freeCredits: number;
  } | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
