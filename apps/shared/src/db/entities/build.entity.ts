import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { RepoEntity } from './repo.entity';

export enum BuildTrigger {
  PR = 'PR',
  MERGE = 'MERGE',
  MANUAL = 'MANUAL',
}

export enum BuildStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity({ name: 'builds' })
export class BuildEntity extends BaseEntity {
  @Column({ type: 'integer', name: 'repo_id' })
  @Index()
  repoId: number;

  @ManyToOne(() => RepoEntity, (r) => r.builds, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repo_id' })
  repo: RepoEntity;

  @Column({ type: 'varchar', length: 20 })
  trigger: BuildTrigger;

  @Column({ type: 'varchar', length: 300 })
  ref: string;

  @Column({ name: 'commit_sha', type: 'varchar', length: 60 })
  commitSha: string;

  @Column({ name: 'pr_number', type: 'integer', nullable: true })
  prNumber: number | null;

  @Column({ type: 'varchar', length: 20, default: BuildStatus.QUEUED })
  status: BuildStatus;

  @Column({ type: 'text', nullable: true })
  log: string | null;

  @Column({ name: 'artifact_path', type: 'text', nullable: true })
  artifactPath: string | null;
}
