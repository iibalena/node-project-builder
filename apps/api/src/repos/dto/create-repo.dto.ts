import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { RepoType } from '@shared/db/entities/repo-type.enum';

export class CreateRepoDto {
  @IsString()
  @IsNotEmpty()
  owner: string;

  @IsString()
  @IsNotEmpty()
  name: string;

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
  @IsString()
  @IsNotEmpty()
  installCommand?: string | null;

  @IsOptional()
  @IsBoolean()
  useLegacyPeerDeps?: boolean;
}
