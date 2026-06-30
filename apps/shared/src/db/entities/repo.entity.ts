import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { BuildEntity } from './build.entity';
import { RepoType } from './repo-type.enum';

@Index(['owner', 'name'], { unique: true })
@Entity({ name: 'repos' })
export class RepoEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  owner: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 30, default: RepoType.TYPESCRIPT })
  type: RepoType;

  @Column({ name: 'clone_url', type: 'text' })
  cloneUrl: string;

  @Column({
    name: 'default_branch',
    type: 'varchar',
    length: 200,
    default: 'master',
  })
  defaultBranch: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({
    name: 'install_command',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  installCommand: string | null;

  @Column({ name: 'use_legacy_peer_deps', type: 'boolean', default: false })
  useLegacyPeerDeps: boolean;

  @Column({ name: 'node_version', type: 'varchar', length: 50, nullable: true })
  nodeVersion: string | null;

  @Column({ name: 'github_installation_id', type: 'bigint', nullable: true })
  githubInstallationId: string | null;

  @Column({ name: 'android_app_id', type: 'varchar', length: 255, nullable: true })
  androidAppId: string | null;

  @Column({ name: 'ios_bundle_id', type: 'varchar', length: 255, nullable: true })
  iosBundleId: string | null;

  // Quando false (default), builds de PR publicam na faixa de Teste interno (TRACK)
  // em vez de Internal App Sharing (que exige o app publicado em producao).
  @Column({ name: 'play_production_ready', type: 'boolean', default: false })
  playProductionReady: boolean;

  // Link de opt-in da faixa de Teste interno (aba Testers do Play Console).
  // Fixo por app; usado no comentario do PR quando se publica via TRACK interno.
  @Column({ name: 'play_internal_testing_url', type: 'text', nullable: true })
  playInternalTestingUrl: string | null;

  @OneToMany(() => BuildEntity, (b) => b.repo)
  builds: BuildEntity[];
}
