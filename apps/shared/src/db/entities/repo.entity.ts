import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BuildEntity } from './build.entity';

@Entity({ name: 'repos' })
export class RepoEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  owner: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text' })
  cloneUrl: string;

  @Column({ type: 'varchar', length: 200, default: 'main' })
  defaultBranch: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => BuildEntity, (b) => b.repo)
  builds: BuildEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
