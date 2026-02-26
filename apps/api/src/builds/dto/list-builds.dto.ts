import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { BuildStatus } from '@shared/db/entities/build.entity';

export class ListBuildsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  repoId?: number;

  @IsOptional()
  @IsEnum(BuildStatus)
  status?: BuildStatus;
}
