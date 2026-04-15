import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BuildEntity,
  BuildStatus,
  BuildTrigger,
} from '../../shared/src/db/entities/build.entity';
import { RepoEntity } from '../../shared/src/db/entities/repo.entity';
import { BuildLogger } from './build-logger';
import { BuildPreparationService } from './build-prep.service';
import { NodeBuilderService } from './node-builder.service';
import { AngularBuilderService } from './angular-builder.service';
import { BuildSyncService } from './build-sync.service';
import { I18nService } from '../../shared/src/i18n/i18n.service';
import { RepoType } from '../../shared/src/db/entities/repo-type.enum';

@Injectable()
export class RunnerService implements OnModuleInit {
  private readonly logger = new Logger(RunnerService.name);
  private interval: NodeJS.Timeout;
  private syncInterval: NodeJS.Timeout;
  private syncRunning = false;
  private buildProcessing = false;

  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    private readonly buildPreparation: BuildPreparationService,
    private readonly nodeBuilder: NodeBuilderService,
    private readonly angularBuilder: AngularBuilderService,
    private readonly buildSync: BuildSyncService,
    private readonly i18n: I18nService,
  ) {}

  onModuleInit() {
    const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 3000);
    const syncOnStart =
      String(process.env.SYNC_ON_START ?? 'true').toLowerCase() !== 'false';
    const syncIntervalMs = Number(process.env.SYNC_INTERVAL_MS ?? 86400000);

    this.logger.log(this.i18n.t('runner.started'));
    this.logger.log(this.i18n.t('runner.polling_interval', { interval: intervalMs }));

    this.interval = setInterval(() => {
      this.processNextBuild().catch((err) => this.logger.error(err));
    }, intervalMs);

    if (syncOnStart) {
      if (!process.env.GITHUB_TOKEN) {
        this.logger.error(
          this.i18n.t('runner.sync_start_token_missing'),
        );
      } else {
        this.logger.log(this.i18n.t('runner.sync_start_enabled'));
      }
      this.runSync({ ignoreCooldown: true }).catch((err) =>
        this.logger.error(err),
      );
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
    if (this.buildProcessing) return;

    const build = await this.buildRepository.findOne({
      where: { status: BuildStatus.QUEUED },
      order: { createdAt: 'ASC' },
      relations: ['repo'],
    });

    if (!build) return;

    await this.processBuild(build);
  }

  async processBuildById(buildId: number) {
    if (!Number.isFinite(buildId)) {
      return { ok: false, message: this.i18n.t('sync.build_id_invalid') };
    }

    if (this.buildProcessing) {
      return { ok: false, message: this.i18n.t('sync.runner_busy') };
    }

    const build = await this.buildRepository.findOne({
      where: { id: buildId },
      relations: ['repo'],
    });

    if (!build) {
      return { ok: false, message: this.i18n.t('sync.build_not_found') };
    }

    if (build.status === BuildStatus.RUNNING) {
      return { ok: false, message: this.i18n.t('sync.build_already_running') };
    }

    if (build.status !== BuildStatus.QUEUED) {
      build.status = BuildStatus.QUEUED;
      await this.buildRepository.save(build);
    }

    await this.processBuild(build);
    return { ok: true, buildId: build.id };
  }

  private async processBuild(build: BuildEntity) {
    this.buildProcessing = true;

    try {

      this.logger.log(this.i18n.t('runner.build_selected', { buildId: build.id }));

      build.status = BuildStatus.RUNNING;
      await this.buildRepository.save(build);

      this.logger.log(this.i18n.t('runner.build_marked_running', { buildId: build.id }));

      const repo = build.repo;
      if (!repo) {
        this.logger.error(
          this.i18n.t('runner.build_repo_missing', { buildId: build.id }),
        );
        build.status = BuildStatus.FAILED;
        build.log = `${build.log ?? ''}\n${this.i18n.t('runner.build_repo_relation_missing')}`;
        await this.buildRepository.save(build);
        return;
      }

      const logger = new BuildLogger(
        build.id,
        this.buildRepository,
        build.prNumber,
        build.ref,
        this.logger,
      );
      const ref =
        build.trigger === BuildTrigger.MANUAL
          ? repo.defaultBranch
          : (build.commitSha ?? repo.defaultBranch);
      let prepared: {
        repoDir: string;
        baseDir: string;
        worktreeDir: string;
        cloneOutput: any;
        fetchRes: any;
        worktreeRes: { success: boolean; stdout: string; stderr: string };
        worktreeFallbackRes: {
          success: boolean;
          stdout: string;
          stderr: string;
        } | null;
      } | null = null;

      try {
      await logger.log(
        this.i18n.t('runner.searching_repo', {
          owner: repo.owner,
          name: repo.name,
        }),
      );
      prepared = await this.buildPreparation.prepare(repo, ref, build.id);
      if (prepared.cloneOutput) {
        await logger.log(
          `--- git clone output ---\n${JSON.stringify(prepared.cloneOutput, null, 2)}`,
        );
      } else if (prepared.fetchRes) {
        await logger.log(
          `--- git fetch output ---\n${JSON.stringify(prepared.fetchRes, null, 2)}`,
        );
      }

      if (!prepared.worktreeRes.success) {
        await logger.log(
          `--- git worktree failed ---\n${prepared.worktreeRes.stderr}`,
        );
        await this.buildRepository.update(build.id, {
          status: BuildStatus.FAILED,
        });
        this.logger.error(
          this.i18n.t('runner.failed_worktree', { buildId: build.id }),
        );
        return;
      }

      if (
        prepared.worktreeFallbackRes &&
        prepared.worktreeFallbackRes.success
      ) {
        await logger.log(
          `--- git worktree fallback output ---\n${prepared.worktreeFallbackRes.stdout}${prepared.worktreeFallbackRes.stderr}`,
        );
      } else {
        await logger.log(
          `--- git worktree output ---\n${prepared.worktreeRes.stdout}${prepared.worktreeRes.stderr}`,
        );
      }

      await logger.log(this.i18n.t('runner.repo_ready', { repoDir: prepared.repoDir }));

      this.logger.log(
        this.i18n.t('runner.repo_ready_internal', {
          buildId: build.id,
          repoDir: prepared.repoDir,
        }),
      );
      await logger.log(this.i18n.t('runner.pipeline_start'));
      const repoType = repo.type ?? RepoType.TYPESCRIPT;
      if (repoType === RepoType.ANGULAR) {
        await this.angularBuilder.build(build, prepared.repoDir);
      } else if (repoType === RepoType.TYPESCRIPT) {
        await this.nodeBuilder.build(build, prepared.repoDir);
      } else {
        await logger.error(
          this.i18n.t('runner.unsupported_repo_type', {
            type: repoType,
          }),
        );
        await this.buildRepository.update(build.id, {
          status: BuildStatus.FAILED,
        });
      }
      } catch (err: any) {
      const message = err?.message ?? String(err);
      await logger.error(this.i18n.t('runner.error_block', { message }));
      await this.buildRepository.update(build.id, {
        status: BuildStatus.FAILED,
      });
      this.logger.error(this.i18n.t('runner.failed', { buildId: build.id, message }));
      } finally {
        if (prepared?.baseDir && prepared?.worktreeDir) {
          try {
            await this.buildPreparation.cleanupWorktree(
              prepared.baseDir,
              prepared.worktreeDir,
            );
            await logger.log(
              this.i18n.t('runner.worktree_removed', {
                worktreeDir: prepared.worktreeDir,
              }),
            );
          } catch (err: any) {
            await logger.error(
              this.i18n.t('runner.worktree_remove_failed', {
                error: err?.message ?? String(err),
              }),
            );
          }
        }
      }
    } finally {
      this.buildProcessing = false;
    }
  }
}
