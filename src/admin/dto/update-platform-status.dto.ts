import { IsEnum } from 'class-validator';
import { SocialPlatformStatus } from '../../entities/social-platform.entity';

export class UpdatePlatformStatusDto {
  @IsEnum(SocialPlatformStatus)
  status: SocialPlatformStatus;
}
