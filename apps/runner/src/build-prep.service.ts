import { Injectable, Logger } from '@nestjs/common';
import { RepoEntity } from '../../shared/src/db/entities/repo.entity';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { I18nService } from '../../shared/src/i18n/i18n.service';

const exec = promisify(_exec);

@Injectable()
export class BuildPreparationService {
  private readonly logger = new Logger(BuildPreparationService.name);

  private readonly cleanupRetries = 4;

  private readonly cleanupRetryDelayMs = 500;

  constructor(private readonly i18n: I18nService) {}

  private getWorkdirRoot() {
    return process.env.WORKDIR ?? path.join(process.cwd(), 'workdir');
  }

  private getRepoDir(repo: RepoEntity) {
    return path.join(this.getWorkdirRoot(), repo.owner, repo.name);
  }

  private getWorktreeDir(repo: RepoEntity, buildId: number) {
    return path.join(
      this.getWorkdirRoot(),
      '_worktrees',
      repo.owner,
      repo.name,
      String(buildId),
    );
  }

  private getRepoWorktreesDir(repo: RepoEntity) {
    return path.join(
      this.getWorkdirRoot(),
      '_worktrees',
      repo.owner,
      repo.name,
    );
  }

  private getAllWorktreesRoot() {
    return path.join(this.getWorkdirRoot(), '_worktrees');
  }

  private getGithubToken() {
    return (process.env.GITHUB_TOKEN ?? '').trim();
  }

  private shouldKeepWorktreeForDebug() {
    return String(process.env.WORKTREE_KEEP_FOR_DEBUG ?? 'false').toLowerCase() === 'true';
  }

  private isHttpsGithubUrl(url: string) {
    return /^https:\/\/github\.com\//i.test(url.trim());
  }

  private getGitGithubAuthArgs() {
    const token = this.getGithubToken();
    if (!token) {
      return { authArgs: '', redactedAuthArgs: '' };
    }

    // GitHub accepts basic auth where username can be x-access-token.
    const basicAuth = Buffer.from(`x-access-token:${token}`, 'utf8').toString(
      'base64',
    );
    return {
      authArgs: `-c http.https://github.com/.extraheader="AUTHORIZATION: basic ${basicAuth}"`,
      redactedAuthArgs:
        '-c http.https://github.com/.extraheader="AUTHORIZATION: basic ***"',
    };
  }

  private async runGit(cwd: string, args: string, redactedArgs?: string) {
    const cmd = `git ${args}`;
    const cmdForLog = `git ${redactedArgs ?? args}`;
    this.logger.log(this.i18n.t('build_prep.running', { cmd: cmdForLog, cwd }));
    try {
      const { stdout, stderr } = await exec(cmd, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        success: true,
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
      };
    } catch (err: any) {
      const message = err?.stderr ?? err?.message ?? String(err);
      return { success: false, stdout: '', stderr: message };
    }
  }

  private isFileLockError(err: unknown) {
    const code = String((err as any)?.code ?? '');
    const message = String((err as any)?.message ?? err ?? '').toUpperCase();
    return (
      code === 'EBUSY' ||
      code === 'EPERM' ||
      message.includes('RESOURCE BUSY') ||
      message.includes('EBUSY')
    );
  }

  private async wait(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async removeDirWithRetries(worktreeDir: string) {
    for (let attempt = 1; attempt <= this.cleanupRetries; attempt += 1) {
      try {
        await fs.promises.rm(worktreeDir, { recursive: true, force: true });
        return;
      } catch (err: unknown) {
        const isLock = this.isFileLockError(err);
        const isLastAttempt = attempt === this.cleanupRetries;
        if (!isLock || isLastAttempt) {
          throw err;
        }

        this.logger.warn(
          this.i18n.t('build_prep.cleanup_retry', {
            attempt,
            total: this.cleanupRetries,
            worktreeDir,
          }),
        );
        await this.wait(this.cleanupRetryDelayMs * attempt);
      }
    }
  }

  private async cleanupPendingWorktrees(repo: RepoEntity, currentBuildId: number) {
    const repoWorktreesDir = this.getRepoWorktreesDir(repo);
    const exists = await fs.promises
      .access(repoWorktreesDir)
      .then(() => true)
      .catch(() => false);

    if (!exists) return;

    const entries = await fs.promises.readdir(repoWorktreesDir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === String(currentBuildId)) continue;

      const staleWorktreeDir = path.join(repoWorktreesDir, entry.name);
      try {
        await this.removeDirWithRetries(staleWorktreeDir);
        this.logger.log(
          this.i18n.t('build_prep.cleanup_pending_removed', {
            worktreeDir: staleWorktreeDir,
          }),
        );
      } catch (err: unknown) {
        if (this.isFileLockError(err)) {
          this.logger.warn(
            this.i18n.t('build_prep.cleanup_pending_locked', {
              worktreeDir: staleWorktreeDir,
              error: (err as any)?.message ?? String(err),
            }),
          );
          continue;
        }
        throw err;
      }
    }
  }

  async prepare(repo: RepoEntity, ref: string, buildId: number) {
    const repoDir = this.getRepoDir(repo);
    const worktreeDir = this.getWorktreeDir(repo, buildId);

    // ensure parent exists
    await fs.promises.mkdir(path.dirname(repoDir), { recursive: true });

    if (!this.shouldKeepWorktreeForDebug()) {
      await this.cleanupPendingWorktrees(repo, buildId);
    }

    const exists = await fs.promises
      .access(repoDir)
      .then(() => true)
      .catch(() => false);

    let cloneOutput: {
      success: boolean;
      stdout: string;
      stderr: string;
    } | null = null;
    let fetchRes: { success: boolean; stdout: string; stderr: string } | null =
      null;

    if (!exists) {
      this.logger.log(
        this.i18n.t('build_prep.cloning', {
          owner: repo.owner,
          name: repo.name,
          repoDir,
        }),
      );
      const parent = path.dirname(repoDir);
      await fs.promises.mkdir(parent, { recursive: true });
      const { authArgs, redactedAuthArgs } = this.isHttpsGithubUrl(repo.cloneUrl)
        ? this.getGitGithubAuthArgs()
        : { authArgs: '', redactedAuthArgs: '' };
      const cloneArgs = `${authArgs} clone "${repo.cloneUrl}" "${repo.name}"`.trim();
      const redactedCloneArgs = `${redactedAuthArgs} clone "${repo.cloneUrl}" "${repo.name}"`.trim();
      cloneOutput = await this.runGit(
        parent,
        cloneArgs,
        redactedCloneArgs,
      );
    } else {
      this.logger.log(
        this.i18n.t('build_prep.fetching', {
          owner: repo.owner,
          name: repo.name,
        }),
      );
      const remoteUrlRes = await this.runGit(repoDir, 'remote get-url origin');
      const remoteUrl = String(remoteUrlRes.stdout ?? '').trim();
      const { authArgs, redactedAuthArgs } = this.isHttpsGithubUrl(remoteUrl)
        ? this.getGitGithubAuthArgs()
        : { authArgs: '', redactedAuthArgs: '' };
      const fetchArgs = `${authArgs} fetch origin --prune`.trim();
      const redactedFetchArgs = `${redactedAuthArgs} fetch origin --prune`.trim();
      fetchRes = await this.runGit(repoDir, fetchArgs, redactedFetchArgs);
    }

    await fs.promises.rm(worktreeDir, { recursive: true, force: true });
    this.logger.log(
      this.i18n.t('build_prep.creating_worktree', {
        buildId,
        ref,
        worktreeDir,
      }),
    );
    let worktreeRes = await this.runGit(
      repoDir,
      `worktree add --force "${worktreeDir}" ${ref}`,
    );
    let worktreeFallbackRes: {
      success: boolean;
      stdout: string;
      stderr: string;
    } | null = null;
    if (!worktreeRes.success) {
      worktreeFallbackRes = await this.runGit(
        repoDir,
        `worktree add --force "${worktreeDir}" origin/${ref}`,
      );
      if (worktreeFallbackRes.success) worktreeRes = worktreeFallbackRes;
    }

    return {
      repoDir: worktreeDir,
      baseDir: repoDir,
      worktreeDir,
      cloneOutput,
      fetched: !!fetchRes,
      fetchRes,
      worktreeRes,
      worktreeFallbackRes,
    };
  }

  async checkoutRef(repoDir: string, ref: string) {
    const res = await this.runGit(repoDir, `checkout --force ${ref}`);
    if (res.success) return res;

    const res2 = await this.runGit(
      repoDir,
      `checkout --force -B tmp-${Date.now()} origin/${ref}`,
    );
    return res2;
  }

  async cleanupWorktree(baseDir: string, worktreeDir: string) {
    await this.runGit(baseDir, `worktree remove --force "${worktreeDir}"`);
    try {
      await this.removeDirWithRetries(worktreeDir);
    } catch (err: unknown) {
      if (this.isFileLockError(err)) {
        this.logger.warn(
          this.i18n.t('build_prep.cleanup_deferred', {
            worktreeDir,
            error: (err as any)?.message ?? String(err),
          }),
        );
        return;
      }
      throw err;
    }
  }

  async cleanupStaleWorktreesGlobal() {
    const root = this.getAllWorktreesRoot();
    const exists = await fs.promises
      .access(root)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return { scanned: 0, removed: 0, locked: 0 };
    }

    const owners = await fs.promises.readdir(root, { withFileTypes: true });
    let scanned = 0;
    let removed = 0;
    let locked = 0;

    for (const ownerDir of owners) {
      if (!ownerDir.isDirectory()) continue;
      const ownerPath = path.join(root, ownerDir.name);
      const repos = await fs.promises.readdir(ownerPath, { withFileTypes: true });

      for (const repoDir of repos) {
        if (!repoDir.isDirectory()) continue;
        const repoPath = path.join(ownerPath, repoDir.name);
        const worktrees = await fs.promises.readdir(repoPath, {
          withFileTypes: true,
        });

        for (const worktreeDir of worktrees) {
          if (!worktreeDir.isDirectory()) continue;
          const fullPath = path.join(repoPath, worktreeDir.name);
          scanned += 1;
          try {
            await this.removeDirWithRetries(fullPath);
            removed += 1;
          } catch (err: unknown) {
            if (this.isFileLockError(err)) {
              locked += 1;
              this.logger.warn(
                this.i18n.t('build_prep.cleanup_pending_locked', {
                  worktreeDir: fullPath,
                  error: (err as any)?.message ?? String(err),
                }),
              );
              continue;
            }
            throw err;
          }
        }
      }
    }

    return { scanned, removed, locked };
  }
}
