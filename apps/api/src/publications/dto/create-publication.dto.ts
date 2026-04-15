import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  PublicationPlatform,
  PublicationProvider,
} from '../../../../shared/src/db/entities/publication.entity';

export class CreatePublicationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  buildId: number;

  @IsOptional()
  @IsEnum(PublicationPlatform)
  platform?: PublicationPlatform;

  @IsOptional()
  @IsString()
  track?: string;

  @IsOptional()
  @IsEnum(PublicationProvider)
  provider?: PublicationProvider;
}
