import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
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
export class BuildEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'repo_id' })
  @Index()
  repoId: string;

  @ManyToOne(() => RepoEntity, (r) => r.builds, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repo_id' })
  repo: RepoEntity;

  @Column({ type: 'varchar', length: 20 })
  trigger: BuildTrigger;

  @Column({ type: 'varchar', length: 300 })
  ref: string;

  @Column({ type: 'varchar', length: 60 })
  commitSha: string;

  @Column({ type: 'integer', nullable: true })
  prNumber: number | null;

  @Column({ type: 'varchar', length: 20, default: BuildStatus.QUEUED })
  status: BuildStatus;

  @Column({ type: 'text', nullable: true })
  log: string | null;

  @Column({ type: 'text', nullable: true, name: 'artifact_path' })
  artifactPath: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
