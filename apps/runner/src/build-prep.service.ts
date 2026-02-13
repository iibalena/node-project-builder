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

  async prepare(repo: RepoEntity) {
    const workdirRoot = this.getWorkdirRoot();
    const repoDir = path.join(workdirRoot, repo.owner, repo.name);

    // ensure parent exists
    await fs.promises.mkdir(path.dirname(repoDir), { recursive: true });

    const exists = await fs.promises
      .access(repoDir)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      // clone
      this.logger.log(`Clonando ${repo.owner}/${repo.name} em ${repoDir}`);
      const parent = path.dirname(repoDir);
      await fs.promises.mkdir(parent, { recursive: true });
      const res = await this.runGit(parent, `clone ${repo.cloneUrl} ${repo.name}`);
      return { repoDir, cloneOutput: res, fetched: false };
    }

    // fetch updates
    this.logger.log(`Atualizando ${repo.owner}/${repo.name} via git fetch`);
    const fetchRes = await this.runGit(repoDir, 'fetch --all --prune');
    return { repoDir, cloneOutput: null, fetched: true, fetchRes };
  }

  async checkoutRef(repoDir: string, ref: string) {
    const res = await this.runGit(repoDir, `checkout --force ${ref}`);
    if (res.success) return res;

    const res2 = await this.runGit(repoDir, `checkout --force -B tmp-${Date.now()} origin/${ref}`);
    return res2;
  }
}
