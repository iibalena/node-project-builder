import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuildEntity, BuildStatus, BuildTrigger } from '@shared/db/entities/build.entity';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { BuildLogger } from './build-logger';
import { BuildPreparationService } from './build-prep.service';
import { NodeBuilderService } from './node-builder.service';
import { BuildSyncService } from './build-sync.service';

@Injectable()
export class RunnerService implements OnModuleInit {
  private readonly logger = new Logger(RunnerService.name);
  private interval: NodeJS.Timeout;
  private syncInterval: NodeJS.Timeout;
  private syncRunning = false;

  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    private readonly buildPreparation: BuildPreparationService,
    private readonly nodeBuilder: NodeBuilderService,
    private readonly buildSync: BuildSyncService,
  ) {}

  onModuleInit() {
    const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 3000);
    const syncOnStart = String(process.env.SYNC_ON_START ?? 'true').toLowerCase() !== 'false';
    const syncIntervalMs = Number(process.env.SYNC_INTERVAL_MS ?? 86400000);

    this.logger.log('Runner iniciado. Preparando filas de build.');
    this.logger.log(`Runner polling every ${intervalMs}ms`);

    this.interval = setInterval(() => {
      this.processNextBuild().catch((err) => this.logger.error(err));
    }, intervalMs);

    if (syncOnStart) {
      if (!process.env.GITHUB_TOKEN) {
        this.logger.warn('Sync on start enabled but GITHUB_TOKEN is not set. Skipping initial sync.');
      } else {
        this.logger.log('Sync on start enabled. Running initial sync now.');
      }
      this.runSync({ ignoreCooldown: true }).catch((err) => this.logger.error(err));
    }

    this.syncInterval = setInterval(() => {
      this.runSync().catch((err) => this.logger.error(err));
    }, syncIntervalMs);
  }

  private async runSync(options?: { ignoreCooldown?: boolean }) {
    if (this.syncRunning) return;
    this.syncRunning = true;
    try {
      await this.buildSync.syncAll(options);
    } finally {
      this.syncRunning = false;
    }
  }


  async processNextBuild() {
    const build = await this.buildRepository.findOne({
      where: { status: BuildStatus.QUEUED },
      order: { createdAt: 'ASC' },
      relations: ['repo'],
    });

    if (!build) return;

    this.logger.log(`Picked build ${build.id}`);

    build.status = BuildStatus.RUNNING;
    await this.buildRepository.save(build);

    this.logger.log(`Build ${build.id} marked as RUNNING`);

    const repo = build.repo as RepoEntity;
    if (!repo) {
      this.logger.error(`Build ${build.id} has no repo relation loaded`);
      build.status = BuildStatus.FAILED;
      build.log = `${build.log ?? ''}\nMissing repo relation`;
      await this.buildRepository.save(build);
      return;
    }

    const logger = new BuildLogger(build.id, this.buildRepository, build.prNumber, build.ref, this.logger);
    const ref = build.trigger === BuildTrigger.MANUAL ? repo.defaultBranch : build.commitSha ?? repo.defaultBranch;
    let prepared: {
      repoDir: string;
      baseDir: string;
      worktreeDir: string;
      cloneOutput: any;
      fetchRes: any;
      worktreeRes: { success: boolean; stdout: string; stderr: string };
      worktreeFallbackRes: { success: boolean; stdout: string; stderr: string } | null;
    } | null = null;

    try {
      await logger.log(`Buscando repositorio ${repo.owner}/${repo.name}`);
      prepared = await this.buildPreparation.prepare(repo, ref, build.id);
      if (prepared.cloneOutput) {
        await logger.log(`--- git clone output ---\n${JSON.stringify(prepared.cloneOutput, null, 2)}`);
      } else if (prepared.fetchRes) {
        await logger.log(`--- git fetch output ---\n${JSON.stringify(prepared.fetchRes, null, 2)}`);
      }

      if (!prepared.worktreeRes.success) {
        await logger.log(`--- git worktree failed ---\n${prepared.worktreeRes.stderr}`);
        await this.buildRepository.update(build.id, { status: BuildStatus.FAILED });
        this.logger.error(`Build ${build.id} failed during worktree creation`);
        return;
      }

      if (prepared.worktreeFallbackRes && prepared.worktreeFallbackRes.success) {
        await logger.log(`--- git worktree fallback output ---\n${prepared.worktreeFallbackRes.stdout}${prepared.worktreeFallbackRes.stderr}`);
      } else {
        await logger.log(`--- git worktree output ---\n${prepared.worktreeRes.stdout}${prepared.worktreeRes.stderr}`);
      }

      await logger.log(`Repo pronto em ${prepared.repoDir}`);

      this.logger.log(`Build ${build.id} repo ready at ${prepared.repoDir}`);
      await logger.log('Iniciando pipeline de build');
      await this.nodeBuilder.build(build, prepared.repoDir);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      await logger.error(`--- runner error ---\n${message}`);
      await this.buildRepository.update(build.id, { status: BuildStatus.FAILED });
      this.logger.error(`Build ${build.id} failed: ${message}`);
    } finally {
      if (prepared?.baseDir && prepared?.worktreeDir) {
        try {
          await this.buildPreparation.cleanupWorktree(prepared.baseDir, prepared.worktreeDir);
          await logger.log(`Worktree removido ${prepared.worktreeDir}`);
        } catch (err: any) {
          await logger.error(`Falha ao remover worktree: ${err?.message ?? String(err)}`);
        }
      }
    }
  }
}
