import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { BuildEntity } from './build.entity';

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

  @OneToMany(() => BuildEntity, (b) => b.repo)
  builds: BuildEntity[];
}
