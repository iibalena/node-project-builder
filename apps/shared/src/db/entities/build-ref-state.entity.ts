import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Index(['repoId', 'refKey'], { unique: true })
@Entity({ name: 'build_ref_state' })
export class BuildRefStateEntity extends BaseEntity {
  @Column({ name: 'repo_id', type: 'integer' })
  repoId: number;

  @Column({ name: 'ref_key', type: 'varchar', length: 260 })
  refKey: string;

  @Column({ type: 'varchar', length: 300 })
  ref: string;

  @Column({ name: 'pr_number', type: 'integer', nullable: true })
  prNumber: number | null;

  @Column({ name: 'last_sha', type: 'varchar', length: 60 })
  lastSha: string;

  @Column({ name: 'last_enqueued_at', type: 'timestamptz', nullable: true })
  lastEnqueuedAt: Date | null;
}
