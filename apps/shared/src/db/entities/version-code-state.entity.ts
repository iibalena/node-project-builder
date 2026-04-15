import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { PublicationPlatform } from './publication.entity';

@Index(['repositoryId', 'platform', 'track'], { unique: true })
@Entity({ name: 'version_code_state' })
export class VersionCodeStateEntity extends BaseEntity {
  @Column({ name: 'repository_id', type: 'integer' })
  repositoryId: number;

  @Column({ type: 'varchar', length: 20 })
  platform: PublicationPlatform;

  @Column({ type: 'varchar', length: 40 })
  track: string;

  @Column({ name: 'next_version_code', type: 'integer', default: 1 })
  nextVersionCode: number;

  @Column({ name: 'last_reserved_at', type: 'timestamptz', nullable: true })
  lastReservedAt: Date | null;
}
