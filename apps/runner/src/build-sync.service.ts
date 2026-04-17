import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { RepoEntity } from '../../shared/src/db/entities/repo.entity';
import {
  BuildEntity,
  BuildStatus,
  BuildTrigger,
} from '../../shared/src/db/entities/build.entity';
import { BuildRefStateEntity } from '../../shared/src/db/entities/build-ref-state.entity';
import { RepoType } from '../../shared/src/db/entities/repo-type.enum';
import { GitHubService } from './github.service';
import * as fs from 'fs';
import * as path from 'path';
import { I18nService } from '../../shared/src/i18n/i18n.service';

@Injectable()
export class BuildSyncService {
  private readonly logger = new Logger(BuildSyncService.name);

  private readonly maxAttemptsPerSameSha = 2;

  private isPrOnlyBuildsModeForRepo(repo: RepoEntity) {
    const prOnlyEnabled =
      String(process.env.PR_ONLY_BUILDS ?? 'false').toLowerCase() === 'true';
    return prOnlyEnabled && repo.type === RepoType.FLUTTER;
  }

  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    @InjectRepository(BuildRefStateEntity)
    private readonly refStateRepository: Repository<BuildRefStateEntity>,
    private readonly github: GitHubService,
    private readonly i18n: I18nService,
  ) {}

  private getExecutablesDir() {
    return process.env.EXECUTABLES_DIR ?? '';
  }

  private getCooldownMs() {
    const value = Number(process.env.BUILD_COOLDOWN_MS ?? 60000);
    return Number.isFinite(value) ? value : 60000;
  }

  private async hasActiveBuild(repoId: number, sha: string) {
    return this.buildRepository.findOne({
      where: {
        repoId,
        commitSha: sha,
        status: In([BuildStatus.QUEUED, BuildStatus.RUNNING]),
      },
    });
  }

  private buildRefKey(ref: string, prNumber: number | null) {
    return prNumber ? `pr:${prNumber}` : `branch:${ref}`;
  }

  private async getRefState(repoId: number, refKey: string) {
    return this.refStateRepository.findOne({ where: { repoId, refKey } });
  }

  private async upsertRefState(args: {
    repoId: number;
    refKey: string;
    ref: string;
    prNumber: number | null;
    sha: string;
    enqueuedAt: Date;
  }) {
    const existing = await this.getRefState(args.repoId, args.refKey);
    if (existing) {
      existing.lastSha = args.sha;
      existing.ref = args.ref;
      existing.prNumber = args.prNumber;
      existing.lastEnqueuedAt = args.enqueuedAt;
      return this.refStateRepository.save(existing);
    }

    return this.refStateRepository.save(
      this.refStateRepository.create({
        repoId: args.repoId,
        refKey: args.refKey,
        ref: args.ref,
        prNumber: args.prNumber,
        lastSha: args.sha,
        lastEnqueuedAt: args.enqueuedAt,
      }),
    );
  }

  private async enqueueBuild(args: {
    repo: RepoEntity;
    trigger: BuildTrigger;
    ref: string;
    sha: string;
    prNumber: number | null;
    ignoreCooldown?: boolean;
    force?: boolean;
  }) {
    this.logger.log(
      this.i18n.t('build_sync.eval', {
        owner: args.repo.owner,
        name: args.repo.name,
        ref: args.ref,
        pr: args.prNumber ?? 'branch',
        sha: args.sha,
      }),
    );
    if (args.force) {
      this.logger.log(
        this.i18n.t('build_sync.force', {
          owner: args.repo.owner,
          name: args.repo.name,
          ref: args.ref,
          pr: args.prNumber ?? 'branch',
        }),
      );
    }
    const refKey = this.buildRefKey(args.ref, args.prNumber);
    const state = await this.getRefState(args.repo.id, refKey);
    if (!args.force && state && state.lastSha === args.sha) {
      const prNumberCriteria =
        args.prNumber === null ? IsNull() : args.prNumber;

      const latestForSameSha = await this.buildRepository.findOne({
        where: {
          repoId: args.repo.id,
          ref: args.ref,
          prNumber: prNumberCriteria,
          commitSha: args.sha,
        },
        order: { createdAt: 'DESC' },
      });

      if (latestForSameSha?.status === BuildStatus.SUCCESS) {
        this.logger.log(
          this.i18n.t('build_sync.skip_success', {
            owner: args.repo.owner,
            name: args.repo.name,
            ref: args.ref,
            pr: args.prNumber ?? 'branch',
          }),
        );
        return false;
      }

      const attemptsForSameSha = await this.buildRepository.count({
        where: {
          repoId: args.repo.id,
          ref: args.ref,
          prNumber: prNumberCriteria,
          commitSha: args.sha,
        },
      });

      if (attemptsForSameSha >= this.maxAttemptsPerSameSha) {
        this.logger.log(
          this.i18n.t('build_sync.skip_same_sha_after_retry', {
            owner: args.repo.owner,
            name: args.repo.name,
            ref: args.ref,
            pr: args.prNumber ?? 'branch',
            attempts: attemptsForSameSha,
          }),
        );
        return false;
      }

      this.logger.log(
        this.i18n.t('build_sync.retry_same_sha', {
          owner: args.repo.owner,
          name: args.repo.name,
          ref: args.ref,
          pr: args.prNumber ?? 'branch',
          attempts: attemptsForSameSha,
          maxAttempts: this.maxAttemptsPerSameSha,
        }),
      );
    }

    if (!args.force && !args.ignoreCooldown && state?.lastEnqueuedAt) {
      const elapsed = Date.now() - state.lastEnqueuedAt.getTime();
      if (elapsed < this.getCooldownMs()) {
        this.logger.log(
          this.i18n.t('build_sync.skip_cooldown', {
            owner: args.repo.owner,
            name: args.repo.name,
            ref: args.ref,
            pr: args.prNumber ?? 'branch',
          }),
        );
        return false;
      }
    }

    if (!args.force) {
      const queued = await this.hasActiveBuild(args.repo.id, args.sha);
      if (queued) {
        this.logger.log(
          this.i18n.t('build_sync.skip_active', {
            owner: args.repo.owner,
            name: args.repo.name,
            ref: args.ref,
            pr: args.prNumber ?? 'branch',
            buildId: queued.id,
          }),
        );
        return false;
      }
    }

    const createdBuild = await this.buildRepository.save(
      this.buildRepository.create({
        repoId: args.repo.id,
        trigger: args.trigger,
        ref: args.ref,
        commitSha: args.sha,
        prNumber: args.prNumber,
        status: BuildStatus.QUEUED,
      }),
    );

    this.logger.log(
      this.i18n.t('build_sync.enqueued', {
        owner: args.repo.owner,
        name: args.repo.name,
        ref: args.ref,
        pr: args.prNumber ?? 'branch',
        buildId: createdBuild.id,
      }),
    );

    await this.upsertRefState({
      repoId: args.repo.id,
      refKey,
      ref: args.ref,
      prNumber: args.prNumber,
      sha: args.sha,
      enqueuedAt: new Date(),
    });

    return true;
  }

  private async cleanupClosedPrExecutables(
    repo: RepoEntity,
    openPrs: Set<number>,
  ) {
    const baseDir = this.getExecutablesDir();
    if (!baseDir) return;

    const repoDir = path.join(baseDir, repo.name);
    const exists = await fs.promises
      .access(repoDir)
      .then(() => true)
      .catch(() => false);

    if (!exists) return;

    const entries = await fs.promises.readdir(repoDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!/^[0-9]+$/.test(entry.name)) continue;

      const prNumber = Number(entry.name);
      if (openPrs.has(prNumber)) continue;

      const fullPath = path.join(repoDir, entry.name);
      await fs.promises.rm(fullPath, { recursive: true, force: true });
      this.logger.log(this.i18n.t('build_sync.closed_pr_removed', { path: fullPath }));
    }
  }

  async syncRepo(repo: RepoEntity, options?: { ignoreCooldown?: boolean }) {
    this.logger.log(
      this.i18n.t('build_sync.fetch_open_prs', {
        owner: repo.owner,
        name: repo.name,
      }),
    );
    let openPrs: { number: number; sha: string; ref: string }[] = [];
    try {
      openPrs = await this.github.listOpenPulls(repo.owner, repo.name);
    } catch (err: any) {
      this.logger.error(
        this.i18n.t('build_sync.fetch_open_prs_failed', {
          owner: repo.owner,
          name: repo.name,
          error: err?.message ?? String(err),
        }),
      );
      return;
    }

    this.logger.log(
      this.i18n.t('build_sync.open_prs_found', {
        count: openPrs.length,
        owner: repo.owner,
        name: repo.name,
      }),
    );

    const openPrNumbers = new Set(openPrs.map((p) => p.number));
    await this.cleanupClosedPrExecutables(repo, openPrNumbers);

    for (const pr of openPrs) {
      if (!pr.sha || !pr.ref) continue;
      this.logger.log(
        this.i18n.t('build_sync.analyze_pr', {
          owner: repo.owner,
          name: repo.name,
          pr: pr.number,
          ref: pr.ref,
        }),
      );
      const created = await this.enqueueBuild({
        repo,
        trigger: BuildTrigger.PR,
        ref: pr.ref,
        sha: pr.sha,
        prNumber: pr.number,
        ignoreCooldown: options?.ignoreCooldown,
      });

      if (created) {
        this.logger.log(
          this.i18n.t('build_sync.pr_enqueued', {
            owner: repo.owner,
            name: repo.name,
            pr: pr.number,
          }),
        );
      }
    }

    if (this.isPrOnlyBuildsModeForRepo(repo)) {
      this.logger.log(
        this.i18n.t('build_sync.branch_skipped_pr_only', {
          owner: repo.owner,
          name: repo.name,
          branch: repo.defaultBranch,
          repoType: repo.type,
        }),
      );
      return;
    }

    try {
      this.logger.log(
        this.i18n.t('build_sync.fetch_branch', {
          branch: repo.defaultBranch,
          owner: repo.owner,
          name: repo.name,
        }),
      );
      const sha = await this.github.getBranchSha(
        repo.owner,
        repo.name,
        repo.defaultBranch,
      );
      if (sha) {
        const created = await this.enqueueBuild({
          repo,
          trigger: BuildTrigger.MERGE,
          ref: repo.defaultBranch,
          sha,
          prNumber: null,
          ignoreCooldown: options?.ignoreCooldown,
        });

        if (created) {
          this.logger.log(
            this.i18n.t('build_sync.branch_enqueued', {
              owner: repo.owner,
              name: repo.name,
              branch: repo.defaultBranch,
            }),
          );
        }
      }
    } catch (err: any) {
      this.logger.error(
        this.i18n.t('build_sync.branch_read_failed', {
          branch: repo.defaultBranch,
          owner: repo.owner,
          name: repo.name,
          error: err?.message ?? String(err),
        }),
      );
    }
  }

  async syncSelection(args: {
    repo: RepoEntity;
    prNumber?: number;
    ref?: string;
    force?: boolean;
  }) {
    this.logger.log(
      this.i18n.t('build_sync.manual', {
        owner: args.repo.owner,
        name: args.repo.name,
        pr: args.prNumber ?? 'n/a',
        ref: args.ref ?? 'n/a',
      }),
    );
    if (args.prNumber) {
      let openPrs: { number: number; sha: string; ref: string }[] = [];
      try {
        openPrs = await this.github.listOpenPulls(
          args.repo.owner,
          args.repo.name,
        );
      } catch (err: any) {
        this.logger.error(
          this.i18n.t('build_sync.fetch_open_prs_failed', {
            owner: args.repo.owner,
            name: args.repo.name,
            error: err?.message ?? String(err),
          }),
        );
        return { ok: false, message: this.i18n.t('build_sync.failed_to_list_prs') };
      }

      const match = openPrs.find((pr) => pr.number === args.prNumber);
      if (!match?.sha || !match?.ref) {
        return { ok: false, message: this.i18n.t('build_sync.pr_not_found') };
      }

      const created = await this.enqueueBuild({
        repo: args.repo,
        trigger: BuildTrigger.PR,
        ref: match.ref,
        sha: match.sha,
        prNumber: match.number,
        force: args.force,
      });

      return { ok: true, enqueued: created, ref: match.ref, sha: match.sha };
    }

    if (this.isPrOnlyBuildsModeForRepo(args.repo)) {
      return {
        ok: false,
        message: this.i18n.t('build_sync.manual_branch_blocked_pr_only'),
      };
    }

    const ref = args.ref?.trim() || args.repo.defaultBranch;
    if (!args.ref) {
      this.logger.log(
        this.i18n.t('build_sync.manual_default_branch', {
          branch: ref,
          owner: args.repo.owner,
          name: args.repo.name,
        }),
      );
    }
    try {
      const sha = await this.github.getBranchSha(
        args.repo.owner,
        args.repo.name,
        ref,
      );
      if (!sha) {
        return { ok: false, message: this.i18n.t('build_sync.sha_not_found') };
      }

      const created = await this.enqueueBuild({
        repo: args.repo,
        trigger: BuildTrigger.MERGE,
        ref,
        sha,
        prNumber: null,
        force: args.force,
      });

      return { ok: true, enqueued: created, ref, sha };
    } catch (err: any) {
      this.logger.error(
        this.i18n.t('build_sync.branch_read_failed', {
          branch: ref,
          owner: args.repo.owner,
          name: args.repo.name,
          error: err?.message ?? String(err),
        }),
      );
      return { ok: false, message: this.i18n.t('build_sync.branch_read_failed_code') };
    }
  }

  async syncAll(options?: { ignoreCooldown?: boolean }) {
    if (!process.env.GITHUB_TOKEN) {
      this.logger.error(this.i18n.t('build_sync.sync_skipped_token'));
      return;
    }

    this.logger.log(this.i18n.t('build_sync.search_active_repos'));
    const repos = await this.repoRepository.find({ where: { isActive: true } });
    if (repos.length === 0) return;

    this.logger.log(this.i18n.t('build_sync.sync_start', { count: repos.length }));
    for (const repo of repos) {
      this.logger.log(
        this.i18n.t('build_sync.repo_found', {
          owner: repo.owner,
          name: repo.name,
        }),
      );
      await this.syncRepo(repo, options);
    }
    this.logger.log(this.i18n.t('build_sync.done'));
  }
}
