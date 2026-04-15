import { IsBoolean, IsOptional } from 'class-validator';

export class ExecutePublicationDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
