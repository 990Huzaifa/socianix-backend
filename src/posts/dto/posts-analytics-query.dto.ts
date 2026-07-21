import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';

export enum PostsAnalyticsRange {
  DAYS_7 = '7d',
  DAYS_30 = '30d',
  DAYS_90 = '90d',
}

export class PostsAnalyticsQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    return value;
  })
  @IsEnum(PostsAnalyticsRange)
  range?: PostsAnalyticsRange = PostsAnalyticsRange.DAYS_30;
}
