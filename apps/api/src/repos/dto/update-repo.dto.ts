import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
