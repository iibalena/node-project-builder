import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { BuildEntity, BuildStatus, BuildTrigger } from '@shared/db/entities/build.entity';
import { BuildRefStateEntity } from '@shared/db/entities/build-ref-state.entity';
import { GitHubService } from './github.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BuildSyncService {
  private readonly logger = new Logger(BuildSyncService.name);

  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    @InjectRepository(BuildRefStateEntity)
    private readonly refStateRepository: Repository<BuildRefStateEntity>,
    private readonly github: GitHubService,
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
  }) {
    this.logger.log(
      `Sync avaliando ${args.repo.owner}/${args.repo.name} ref=${args.ref} pr=${args.prNumber ?? 'branch'} sha=${args.sha}`,
    );
    const refKey = this.buildRefKey(args.ref, args.prNumber);
    const state = await this.getRefState(args.repo.id, refKey);
    if (state && state.lastSha === args.sha) {
      const hasSuccess = await this.buildRepository.findOne({
        where: {
          repoId: args.repo.id,
          ref: args.ref,
          prNumber: args.prNumber === null ? IsNull() : args.prNumber,
          commitSha: args.sha,
          status: BuildStatus.SUCCESS,
        },
        order: { createdAt: 'DESC' },
      });

      if (hasSuccess) {
        this.logger.log(`Build skip (same SHA, already SUCCESS) ${args.repo.owner}/${args.repo.name} ref=${args.ref} pr=${args.prNumber ?? 'branch'}`);
        return false;
      }

      this.logger.log(`Build retry (same SHA, last not successful) ${args.repo.owner}/${args.repo.name} ref=${args.ref} pr=${args.prNumber ?? 'branch'}`);
    }

    if (!args.ignoreCooldown && state?.lastEnqueuedAt) {
      const elapsed = Date.now() - state.lastEnqueuedAt.getTime();
      if (elapsed < this.getCooldownMs()) {
        this.logger.log(`Build skip (cooldown) ${args.repo.owner}/${args.repo.name} ref=${args.ref} pr=${args.prNumber ?? 'branch'}`);
        return false;
      }
    }

    const queued = await this.hasActiveBuild(args.repo.id, args.sha);
    if (queued) {
      this.logger.log(
        `Build skip (active build) ${args.repo.owner}/${args.repo.name} ref=${args.ref} pr=${args.prNumber ?? 'branch'} buildId=${queued.id}`,
      );
      return false;
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
      `Build enqueued ${args.repo.owner}/${args.repo.name} ref=${args.ref} pr=${args.prNumber ?? 'branch'} buildId=${createdBuild.id}`,
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

  private async cleanupClosedPrExecutables(repo: RepoEntity, openPrs: Set<number>) {
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
      this.logger.log(`Removed closed PR folder ${fullPath}`);
    }
  }

  async syncRepo(repo: RepoEntity, options?: { ignoreCooldown?: boolean }) {
    this.logger.log(`Buscando PRs abertos para ${repo.owner}/${repo.name}`);
    let openPrs: { number: number; sha: string; ref: string }[] = [];
    try {
      openPrs = await this.github.listOpenPulls(repo.owner, repo.name);
    } catch (err: any) {
      this.logger.error(`Failed to list PRs for ${repo.owner}/${repo.name}: ${err?.message ?? String(err)}`);
      return;
    }

    this.logger.log(`Encontrados ${openPrs.length} PRs abertos em ${repo.owner}/${repo.name}`);

    const openPrNumbers = new Set(openPrs.map((p) => p.number));
    await this.cleanupClosedPrExecutables(repo, openPrNumbers);

    for (const pr of openPrs) {
      if (!pr.sha || !pr.ref) continue;
      this.logger.log(`Analisando PR ${repo.owner}/${repo.name} pr=${pr.number} ref=${pr.ref}`);
      const created = await this.enqueueBuild({
        repo,
        trigger: BuildTrigger.PR,
        ref: pr.ref,
        sha: pr.sha,
        prNumber: pr.number,
        ignoreCooldown: options?.ignoreCooldown,
      });

      if (created) {
        this.logger.log(`Enqueued PR build for ${repo.owner}/${repo.name} pr=${pr.number}`);
      }
    }

    try {
      this.logger.log(`Buscando branch ${repo.defaultBranch} em ${repo.owner}/${repo.name}`);
      const sha = await this.github.getBranchSha(repo.owner, repo.name, repo.defaultBranch);
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
          this.logger.log(`Enqueued branch build for ${repo.owner}/${repo.name} ref=${repo.defaultBranch}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to read branch ${repo.defaultBranch} for ${repo.owner}/${repo.name}: ${err?.message ?? String(err)}`);
    }
  }

  async syncSelection(args: {
    repo: RepoEntity;
    prNumber?: number;
    ref?: string;
  }) {
    this.logger.log(
      `Sync manual ${args.repo.owner}/${args.repo.name} pr=${args.prNumber ?? 'n/a'} ref=${args.ref ?? 'n/a'}`,
    );
    if (args.prNumber) {
      let openPrs: { number: number; sha: string; ref: string }[] = [];
      try {
        openPrs = await this.github.listOpenPulls(args.repo.owner, args.repo.name);
      } catch (err: any) {
        this.logger.error(`Failed to list PRs for ${args.repo.owner}/${args.repo.name}: ${err?.message ?? String(err)}`);
        return { ok: false, message: 'failed_to_list_prs' };
      }

      const match = openPrs.find((pr) => pr.number === args.prNumber);
      if (!match?.sha || !match?.ref) {
        return { ok: false, message: 'pr_not_found' };
      }

      const created = await this.enqueueBuild({
        repo: args.repo,
        trigger: BuildTrigger.PR,
        ref: match.ref,
        sha: match.sha,
        prNumber: match.number,
      });

      return { ok: true, enqueued: created, ref: match.ref, sha: match.sha };
    }

    const ref = args.ref?.trim() || args.repo.defaultBranch;
    if (!args.ref) {
      this.logger.log(`Sync manual sem PR informado. Usando branch ${ref} em ${args.repo.owner}/${args.repo.name}`);
    }
    try {
      const sha = await this.github.getBranchSha(args.repo.owner, args.repo.name, ref);
      if (!sha) return { ok: false, message: 'sha_not_found' };

      const created = await this.enqueueBuild({
        repo: args.repo,
        trigger: BuildTrigger.MERGE,
        ref,
        sha,
        prNumber: null,
      });

      return { ok: true, enqueued: created, ref, sha };
    } catch (err: any) {
      this.logger.error(`Failed to read branch ${ref} for ${args.repo.owner}/${args.repo.name}: ${err?.message ?? String(err)}`);
      return { ok: false, message: 'branch_read_failed' };
    }
  }

  async syncAll(options?: { ignoreCooldown?: boolean }) {
    if (!process.env.GITHUB_TOKEN) {
      this.logger.warn('GITHUB_TOKEN not set. Skipping sync.');
      return;
    }

    this.logger.log('Buscando repos ativos...');
    const repos = await this.repoRepository.find({ where: { isActive: true } });
    if (repos.length === 0) return;

    this.logger.log(`Sync start: ${repos.length} repos`);
    for (const repo of repos) {
      this.logger.log(`Encontrado repo ${repo.owner}/${repo.name}`);
      await this.syncRepo(repo, options);
    }
    this.logger.log('Sync done.');
  }
}
