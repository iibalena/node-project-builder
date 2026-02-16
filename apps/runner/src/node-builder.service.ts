import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuildEntity, BuildStatus } from '@shared/db/entities/build.entity';
import { BuildLogger } from './build-logger';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const exec = promisify(_exec);

@Injectable()
export class NodeBuilderService {
  private readonly logger = new Logger(NodeBuilderService.name);

  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
  ) {}

  private async findExe(root: string, depth = 4): Promise<string | null> {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(root, e.name);
      if (e.isFile() && p.toLowerCase().endsWith('.exe')) return p;
    }
    if (depth <= 0) return null;
    for (const e of entries) {
      if (e.isDirectory()) {
        const p = path.join(root, e.name);
        const found = await this.findExe(p, depth - 1);
        if (found) return found;
      }
    }
    return null;
  }

  private getExecutablesDir() {
    return process.env.EXECUTABLES_DIR ?? '';
  }

  private sanitizeSegment(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, '-').trim();
  }

  private async removeDirIfExists(dir: string) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }

  private getCompileTimeoutMs() {
    const value = Number(process.env.COMPILE_TIMEOUT_MS ?? 600000);
    return Number.isFinite(value) ? value : 600000;
  }

  private async removeDirWithRetry(dir: string, attempts = 3, delayMs = 300) {
    for (let i = 0; i < attempts; i += 1) {
      try {
        await this.removeDirIfExists(dir);
        return;
      } catch (err) {
        if (i === attempts - 1) throw err;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async build(build: BuildEntity, repoDir: string) {
    const logger = new BuildLogger(build.id, this.buildRepository, build.prNumber, build.ref, this.logger);
    try {
      await logger.log(`Build start id=${build.id} trigger=${build.trigger} ref=${build.ref}`);
      const packageJsonPath = path.join(repoDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        await logger.log(`No package.json found in ${repoDir}, skipping build.`);
        await this.buildRepository.update(build.id, { status: BuildStatus.FAILED });
        return;
      }

      const repoInfo = (build as any).repo as any | undefined;
      const usePnpm = fs.existsSync(path.join(repoDir, 'pnpm-lock.yaml'));
      let installCmd = repoInfo?.installCommand ?? (usePnpm ? 'pnpm install' : 'npm install');

      // respect legacy peer deps flag if set on repo and using npm
      const useLegacy = repoInfo?.useLegacyPeerDeps === true;
      if (useLegacy && installCmd.startsWith('npm')) {
        installCmd = `${installCmd} --legacy-peer-deps`;
      }
      const distDir = path.join(repoDir, 'dist');
      await logger.log(`Limpando pasta dist: ${distDir}`);
      await this.removeDirWithRetry(distDir);

      await logger.log(`Realizando comando de instalacao: ${installCmd}`);
      await exec(installCmd, { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 });
      await logger.log('Install finished.');

      const buildCmd = repoInfo?.buildCommand ?? (usePnpm ? 'pnpm run build' : 'npm run build');
      await logger.log(`Realizando build: ${buildCmd}`);
      await exec(buildCmd, { cwd: repoDir, maxBuffer: 20 * 1024 * 1024 });
      await logger.log('Build finished.');

      const compileScript = path.join(repoDir, 'scripts', 'compile.js');
      if (fs.existsSync(compileScript)) {
        await logger.log('Running scripts/compile.js');
        await exec(`node ${path.relative(repoDir, compileScript)}`, {
          cwd: repoDir,
          maxBuffer: 20 * 1024 * 1024,
          timeout: this.getCompileTimeoutMs(),
        });
        await logger.log('compile.js finished.');
      } else {
        await logger.log('No scripts/compile.js found, skipping.');
      }

      // attempt to run nexe script if present
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const hasNexe = pkg.scripts && (pkg.scripts['nexe:win'] || pkg.scripts['nexe']);
      if (hasNexe) {
        const scriptName = pkg.scripts['nexe:win'] ? 'nexe:win' : 'nexe';
        const nexeCmd = usePnpm ? `pnpm run ${scriptName}` : `npm run ${scriptName}`;
        await logger.log(`Running ${scriptName}: ${nexeCmd}`);
        await exec(nexeCmd, { cwd: repoDir, maxBuffer: 50 * 1024 * 1024 });
        await logger.log(`${scriptName} finished.`);
      } else {
        await logger.log('No nexe script found in package.json, skipping.');
      }

      const exePath = await this.findExe(repoDir, 5);
      if (!exePath) throw new Error('Executable (.exe) not found after build');

      const repoName = this.sanitizeSegment(repoInfo?.name ?? 'unknown');
      const refSegment = build.prNumber ? String(build.prNumber) : this.sanitizeSegment(build.ref || 'master');
      const artifactsDir = process.env.ARTIFACTS_DIR ?? path.join(process.cwd(), 'artifacts');
      const stagingDir = path.join(artifactsDir, repoName, build.id.toString());
      const stagingPath = path.join(stagingDir, path.basename(exePath));

      await fs.promises.mkdir(stagingDir, { recursive: true });
      await fs.promises.copyFile(exePath, stagingPath);
      await logger.log(`Artifact staged at ${stagingPath}`);

      const executablesDir = this.getExecutablesDir() || artifactsDir;
      const finalDir = path.join(executablesDir, repoName, refSegment);
      await fs.promises.mkdir(finalDir, { recursive: true });
      const finalPath = path.join(finalDir, path.basename(exePath));
      await fs.promises.copyFile(stagingPath, finalPath);
      await logger.log(`Artifact copied to ${finalPath}`);

      await this.removeDirIfExists(stagingDir);
      await logger.log(`Cleaned staging folder ${stagingDir}`);

      await this.buildRepository.update(build.id, { status: BuildStatus.SUCCESS, artifactPath: finalPath });
    } catch (err: any) {
      await logger.error(`Build error: ${err?.message ?? String(err)}`);
      await this.buildRepository.update(build.id, { status: BuildStatus.FAILED });
      this.logger.error(err?.message ?? String(err));
    }
  }
}
