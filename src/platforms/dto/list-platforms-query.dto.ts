import { IsEnum, IsOptional } from 'class-validator';
import { SocialPlatformStatus } from '../../entities/social-platform.entity';

export class ListPlatformsQueryDto {
  /** Optional filter: active | deactive | comingSoon */
  @IsOptional()
  @IsEnum(SocialPlatformStatus)
  status?: SocialPlatformStatus;
}
