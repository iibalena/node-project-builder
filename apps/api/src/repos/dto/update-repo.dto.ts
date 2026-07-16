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

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nodeVersion?: string | null;

  @IsOptional()
  @IsBoolean()
  playProductionReady?: boolean;

  @IsOptional()
  @IsString()
  playInternalTestingUrl?: string | null;

  @IsOptional()
  @IsString()
  androidKeystorePath?: string | null;

  @IsOptional()
  @IsString()
  androidKeystoreKeyAlias?: string | null;

  @IsOptional()
  @IsString()
  androidKeystoreStorePassword?: string | null;

  @IsOptional()
  @IsString()
  androidKeystoreKeyPassword?: string | null;
}
