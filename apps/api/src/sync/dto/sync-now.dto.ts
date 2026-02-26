import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SyncNowDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  repoId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  prNumber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pr?: number;

  @IsOptional()
  @IsString()
  ref?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force?: boolean;
}
