import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import {
  PublicationPlatform,
  PublicationStatus,
} from '../../../../shared/src/db/entities/publication.entity';

export class ListPublicationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  buildId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  repositoryId?: number;

  @IsOptional()
  @IsEnum(PublicationPlatform)
  platform?: PublicationPlatform;

  @IsOptional()
  @IsEnum(PublicationStatus)
  status?: PublicationStatus;
}
