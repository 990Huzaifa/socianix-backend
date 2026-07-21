import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const GOOGLE_CTA_ACTION_TYPES = [
  'BOOK',
  'ORDER',
  'SHOP',
  'LEARN_MORE',
  'SIGN_UP',
  'CALL',
] as const;

export type GoogleCtaActionType = (typeof GOOGLE_CTA_ACTION_TYPES)[number];

/** Client-facing create intents. `Published` is set server-side after publish finishes. */
export enum CreatePostStatus {
  DRAFT = 'Draft',
  SCHEDULED = 'Scheduled',
  PUBLISHING = 'Publishing',
}

const CTA_ACTIONS_REQUIRING_URL: GoogleCtaActionType[] = [
  'BOOK',
  'ORDER',
  'SHOP',
  'LEARN_MORE',
  'SIGN_UP',
];

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return false;
}

export class CreatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  caption?: string;

  @IsEnum(CreatePostStatus)
  postStatus: CreatePostStatus;

  @ValidateIf((o: CreatePostDto) => o.postStatus === CreatePostStatus.SCHEDULED)
  @IsDateString()
  @IsNotEmpty()
  scheduledAt?: string;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  googlePost?: boolean;

  @ValidateIf((o: CreatePostDto) => o.googlePost === true)
  @IsString()
  @IsNotEmpty()
  googleAccountId?: string;

  @ValidateIf((o: CreatePostDto) => o.googlePost === true)
  @IsString()
  @IsNotEmpty()
  googleLocationId?: string;

  @ValidateIf((o: CreatePostDto) => o.googlePost === true)
  @IsEnum(GOOGLE_CTA_ACTION_TYPES)
  googleCtaActionType?: GoogleCtaActionType;

  @ValidateIf(
    (o: CreatePostDto) =>
      o.googlePost === true &&
      !!o.googleCtaActionType &&
      CTA_ACTIONS_REQUIRING_URL.includes(o.googleCtaActionType),
  )
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  googleCtaUrl?: string;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  pinterestPost?: boolean;

  @ValidateIf((o: CreatePostDto) => o.pinterestPost === true)
  @IsString()
  @IsNotEmpty()
  pinterestBoardId?: string;

  @ValidateIf((o: CreatePostDto) => o.pinterestPost === true)
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  pinterestLink?: string;

  /** Facebook Page post via Meta */
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  facebookPost?: boolean;

  @ValidateIf((o: CreatePostDto) => o.facebookPost === true)
  @IsString()
  @IsNotEmpty()
  facebookPageId?: string;

  @ValidateIf((o: CreatePostDto) => o.facebookPost === true)
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  facebookLink?: string;

  /** Instagram Business post via Meta (IG id resolved from connected account) */
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  instagramPost?: boolean;

  /** LinkedIn personal profile post */
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  linkedinPost?: boolean;

  /** LinkedIn organization / company page post */
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  linkedinOrganizationPost?: boolean;

  @ValidateIf((o: CreatePostDto) => o.linkedinOrganizationPost === true)
  @IsString()
  @IsNotEmpty()
  linkedinOrganizationId?: string;

  @ValidateIf(
    (o: CreatePostDto) =>
      o.linkedinPost === true || o.linkedinOrganizationPost === true,
  )
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  linkedinLink?: string;

  /** Threads post (user id from connected Threads account) */
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  threadPost?: boolean;

  /** TikTok post (video preferred; images supported as photo post) */
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  tiktokPost?: boolean;

  /**
   * TikTok privacy: true = PUBLIC_TO_EVERYONE, false = SELF_ONLY.
   * Required when tiktokPost is true.
   */
  @ValidateIf((o: CreatePostDto) => o.tiktokPost === true)
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  privacyLevel?: boolean;
}
