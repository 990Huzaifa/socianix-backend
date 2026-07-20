import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export class AdminListQueryDto {
  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value, 1))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value, 20))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
