import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PublicationStatus } from '../../../../shared/src/db/entities/publication.entity';

export class UpdatePublicationStatusDto {
  @IsEnum(PublicationStatus)
  status: PublicationStatus;

  @IsOptional()
  @IsString()
  externalReleaseId?: string;
}
