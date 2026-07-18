import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

function toStringArray(value: unknown): string[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
}

export class LinkedInCreatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  commentary?: string;

  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({ require_tld: false }, { each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  link?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  linkTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  linkDescription?: string;
}

export class LinkedInPagePostDto extends LinkedInCreatePostDto {
  @IsString()
  @IsNotEmpty()
  organizationId!: string;
}
