import { Injectable, Logger } from '@nestjs/common';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const exec = promisify(_exec);

@Injectable()
export class BuildPreparationService {
  private readonly logger = new Logger(BuildPreparationService.name);

  private getWorkdirRoot() {
    return process.env.WORKDIR ?? path.join(process.cwd(), 'workdir');
  }

  private getRepoDir(repo: RepoEntity) {
    return path.join(this.getWorkdirRoot(), repo.owner, repo.name);
  }

  private getWorktreeDir(repo: RepoEntity, buildId: number) {
    return path.join(this.getWorkdirRoot(), '_worktrees', repo.owner, repo.name, String(buildId));
  }

  private async runGit(cwd: string, args: string) {
    const cmd = `git ${args}`;
    this.logger.log(`Running: ${cmd} (cwd=${cwd})`);
    try {
      const { stdout, stderr } = await exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 });
      return { success: true, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' };
    } catch (err: any) {
      const message = err?.stderr ?? err?.message ?? String(err);
      return { success: false, stdout: '', stderr: message };
    }
  }

  async prepare(repo: RepoEntity, ref: string, buildId: number) {
    const repoDir = this.getRepoDir(repo);
    const worktreeDir = this.getWorktreeDir(repo, buildId);

    // ensure parent exists
    await fs.promises.mkdir(path.dirname(repoDir), { recursive: true });

    const exists = await fs.promises
      .access(repoDir)
      .then(() => true)
      .catch(() => false);

    let cloneOutput: { success: boolean; stdout: string; stderr: string } | null = null;
    let fetchRes: { success: boolean; stdout: string; stderr: string } | null = null;

    if (!exists) {
      this.logger.log(`Clonando ${repo.owner}/${repo.name} em ${repoDir}`);
      const parent = path.dirname(repoDir);
      await fs.promises.mkdir(parent, { recursive: true });
      cloneOutput = await this.runGit(parent, `clone ${repo.cloneUrl} ${repo.name}`);
    } else {
      this.logger.log(`Atualizando ${repo.owner}/${repo.name} via git fetch`);
      fetchRes = await this.runGit(repoDir, 'fetch --all --prune');
    }

    await fs.promises.rm(worktreeDir, { recursive: true, force: true });
    this.logger.log(`Criando worktree build=${buildId} ref=${ref} em ${worktreeDir}`);
    let worktreeRes = await this.runGit(repoDir, `worktree add --force "${worktreeDir}" ${ref}`);
    let worktreeFallbackRes: { success: boolean; stdout: string; stderr: string } | null = null;
    if (!worktreeRes.success) {
      worktreeFallbackRes = await this.runGit(repoDir, `worktree add --force "${worktreeDir}" origin/${ref}`);
      if (worktreeFallbackRes.success) worktreeRes = worktreeFallbackRes;
    }

    return { repoDir: worktreeDir, baseDir: repoDir, worktreeDir, cloneOutput, fetched: !!fetchRes, fetchRes, worktreeRes, worktreeFallbackRes };
  }

  async checkoutRef(repoDir: string, ref: string) {
    const res = await this.runGit(repoDir, `checkout --force ${ref}`);
    if (res.success) return res;

    const res2 = await this.runGit(repoDir, `checkout --force -B tmp-${Date.now()} origin/${ref}`);
    return res2;
  }

  async cleanupWorktree(baseDir: string, worktreeDir: string) {
    await this.runGit(baseDir, `worktree remove --force "${worktreeDir}"`);
    await fs.promises.rm(worktreeDir, { recursive: true, force: true });
  }
}
