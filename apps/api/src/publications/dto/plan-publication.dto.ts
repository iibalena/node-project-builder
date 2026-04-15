import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PublicationPlatform } from '../../../../shared/src/db/entities/publication.entity';

export class PlanPublicationDto {
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
  @IsBoolean()
  forceLocalReprocess?: boolean;
}
