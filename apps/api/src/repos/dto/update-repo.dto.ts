import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { RepoType } from '../../../../shared/src/db/entities/repo-type.enum';

export class UpdateRepoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  owner?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(RepoType)
  type?: RepoType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cloneUrl?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  defaultBranch?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  installCommand?: string | null;

  @IsOptional()
  @IsBoolean()
  useLegacyPeerDeps?: boolean;
}
