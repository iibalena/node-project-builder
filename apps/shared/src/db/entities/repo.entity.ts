import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { BuildEntity } from './build.entity';

@Index(['owner', 'name'], { unique: true })
@Entity({ name: 'repos' })
export class RepoEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  owner: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ name: 'clone_url', type: 'text' })
  cloneUrl: string;

  @Column({  name: 'default_branch', type: 'varchar', length: 200, default: 'main' })
  defaultBranch: string;

  @Column({  name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'install_command', type: 'varchar', length: 200, nullable: true })
  installCommand: string | null;

  @Column({ name: 'use_legacy_peer_deps', type: 'boolean', default: false })
  useLegacyPeerDeps: boolean;

  @OneToMany(() => BuildEntity, (b) => b.repo)
  builds: BuildEntity[];
}
