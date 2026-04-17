import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { BuildEntity } from './build.entity';
import { RepoEntity } from './repo.entity';

export enum PublicationPlatform {
  ANDROID = 'android',
  IOS = 'ios',
}

export enum PublicationProvider {
  GOOGLE_PLAY = 'google-play',
}

export enum PublicationDistributionType {
  INTERNAL_APP_SHARING = 'internal-app-sharing',
  TRACK = 'track',
}

export enum PublicationStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

@Index([
  'repositoryId',
  'platform',
  'distributionType',
  'track',
  'commitSha',
  'artifactHash',
])
@Entity({ name: 'publications' })
export class PublicationEntity extends BaseEntity {
  @Column({ name: 'build_id', type: 'integer' })
  @Index()
  buildId: number;

  @ManyToOne(() => BuildEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'build_id' })
  build: BuildEntity;

  @Column({ name: 'repository_id', type: 'integer' })
  @Index()
  repositoryId: number;

  @ManyToOne(() => RepoEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repository_id' })
  repository: RepoEntity;

  @Column({ type: 'varchar', length: 20 })
  platform: PublicationPlatform;

  @Column({
    name: 'distribution_type',
    type: 'varchar',
    length: 40,
    default: PublicationDistributionType.TRACK,
  })
  distributionType: PublicationDistributionType;

  @Column({ type: 'varchar', length: 40, nullable: true })
  track: string | null;

  @Column({ name: 'commit_sha', type: 'varchar', length: 60 })
  commitSha: string;

  @Column({ name: 'artifact_hash', type: 'varchar', length: 128 })
  artifactHash: string;

  @Column({ name: 'version_code', type: 'integer', nullable: true })
  versionCode: number | null;

  @Column({ type: 'varchar', length: 40 })
  provider: PublicationProvider;

  @Column({ name: 'external_release_id', type: 'varchar', length: 255, nullable: true })
  externalReleaseId: string | null;

  @Column({ name: 'download_url', type: 'text', nullable: true })
  downloadUrl: string | null;

  @Column({ name: 'certificate_fingerprint', type: 'varchar', length: 255, nullable: true })
  certificateFingerprint: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'varchar', length: 20 })
  status: PublicationStatus;
}
