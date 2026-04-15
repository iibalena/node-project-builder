import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuildEntity, BuildStatus } from '../../shared/src/db/entities/build.entity';
import { BuildLogger } from './build-logger';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { I18nService } from '../../shared/src/i18n/i18n.service';

const exec = promisify(_exec);

@Injectable()
export class NodeBuilderService {
  private readonly logger = new Logger(NodeBuilderService.name);

  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    private readonly i18n: I18nService,
  ) {}

  private parseOutputFromScript(script: string): string | null {
    const quoted = script.match(/(?:--output|-o)\s+["']([^"']+\.exe)["']/i);
    if (quoted?.[1]) return quoted[1];

    const plain = script.match(/(?:--output|-o)\s+([^\s"']+\.exe)/i);
    if (plain?.[1]) return plain[1];

    return null;
  }

  private parseOutputFromCompileJs(content: string, pkg: any): string | null {
    const literal = content.match(/\boutput\s*:\s*['"]([^'"]+\.exe)['"]/i);
    if (literal?.[1]) return literal[1];

    const appName = String(pkg?.name ?? '').trim();
    if (appName) {
      const concat = content.match(
        /\boutput\s*:\s*['"]([^'"]*)['"]\s*\+\s*appName\s*\+\s*['"]([^'"]*\.exe)['"]/i,
      );
      if (concat?.[1] !== undefined && concat?.[2] !== undefined) {
        return `${concat[1]}${appName}${concat[2]}`;
      }

      const tpl = content.match(/\boutput\s*:\s*`([^`]*\$\{\s*appName\s*\}[^`]*)`/i);
      if (tpl?.[1]) {
        return tpl[1].replace(/\$\{\s*appName\s*\}/g, appName);
      }
    }

    return null;
  }

  private async findConfiguredExePath(repoDir: string, pkg: any): Promise<string | null> {
    const candidates: string[] = [];

    const nexeOutput = pkg?.config?.nexe?.output;
    if (typeof nexeOutput === 'string' && nexeOutput.trim().toLowerCase().endsWith('.exe')) {
      candidates.push(path.resolve(repoDir, nexeOutput.trim()));
    }

    const scripts = pkg?.scripts ?? {};
    const scriptName = scripts['nexe:win'] ? 'nexe:win' : scripts['nexe'] ? 'nexe' : null;
    if (scriptName) {
      const scriptValue = String(scripts[scriptName] ?? '');
      const outputFromScript = this.parseOutputFromScript(scriptValue);
      if (outputFromScript) {
        candidates.push(path.resolve(repoDir, outputFromScript));
      }
    }

    const compileScript = path.join(repoDir, 'scripts', 'compile.js');
    const hasCompileScript = await fs.promises
      .access(compileScript)
      .then(() => true)
      .catch(() => false);

    if (hasCompileScript) {
      const compileContent = await fs.promises.readFile(compileScript, 'utf8');
      const outputFromCompile = this.parseOutputFromCompileJs(compileContent, pkg);
      if (outputFromCompile) {
        candidates.push(path.resolve(repoDir, outputFromCompile));
      }
    }

    for (const exePath of candidates) {
      const exists = await fs.promises
        .access(exePath)
        .then(() => true)
        .catch(() => false);
      if (exists) return exePath;
    }

    return null;
  }

  private getExecutablesDir() {
    return process.env.EXECUTABLES_DIR ?? '';
  }

  private sanitizeSegment(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, '-').trim();
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getVersionedExecutableName(
    exePath: string,
    version?: string,
  ): string {
    const currentName = path.basename(exePath);
    const ext = path.extname(currentName);
    const baseName = path.basename(currentName, ext);
    const cleanVersion = this.sanitizeSegment((version ?? '').trim());

    if (!cleanVersion) return currentName;

    const suffixRegex = new RegExp(`-${this.escapeRegExp(cleanVersion)}$`, 'i');
    if (suffixRegex.test(baseName)) {
      return `${baseName}${ext}`;
    }

    return `${baseName}-${cleanVersion}${ext}`;
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
    const logger = new BuildLogger(
      build.id,
      this.buildRepository,
      build.prNumber,
      build.ref,
      this.logger,
    );
    try {
      await logger.log(
        this.i18n.t('builder.start', {
          id: build.id,
          trigger: build.trigger,
          ref: build.ref,
        }),
      );
      const packageJsonPath = path.join(repoDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        await logger.log(
          this.i18n.t('builder.package_json_missing', { repoDir }),
        );
        await this.buildRepository.update(build.id, {
          status: BuildStatus.FAILED,
        });
        return;
      }

      const repoInfo = (build as any).repo;
      const usePnpm = fs.existsSync(path.join(repoDir, 'pnpm-lock.yaml'));
      let installCmd =
        repoInfo?.installCommand ?? (usePnpm ? 'pnpm install' : 'npm install');

      // respect legacy peer deps flag if set on repo and using npm
      const useLegacy = repoInfo?.useLegacyPeerDeps === true;
      if (useLegacy && installCmd.startsWith('npm')) {
        installCmd = `${installCmd} --legacy-peer-deps`;
      }
      const distDir = path.join(repoDir, 'dist');
      await logger.log(this.i18n.t('builder.clean_dist', { distDir }));
      await this.removeDirWithRetry(distDir);

      await logger.log(this.i18n.t('builder.install_running', { cmd: installCmd }));
      await exec(installCmd, { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 });
      await logger.log(this.i18n.t('builder.install_finished'));

      const buildCmd =
        repoInfo?.buildCommand ??
        (usePnpm ? 'pnpm run build' : 'npm run build');
      await logger.log(this.i18n.t('builder.build_running', { cmd: buildCmd }));
      await exec(buildCmd, { cwd: repoDir, maxBuffer: 20 * 1024 * 1024 });
      await logger.log(this.i18n.t('builder.build_finished'));

      const compileScript = path.join(repoDir, 'scripts', 'compile.js');
      if (fs.existsSync(compileScript)) {
        await logger.log(this.i18n.t('builder.compile_running'));
        const compileResult = await exec(
          `node --unhandled-rejections=strict ${path.relative(repoDir, compileScript)}`,
          {
          cwd: repoDir,
          maxBuffer: 20 * 1024 * 1024,
          timeout: this.getCompileTimeoutMs(),
          },
        );
        const compileOut = `${compileResult.stdout ?? ''}${compileResult.stderr ?? ''}`.trim();
        if (compileOut) {
          await logger.log(`--- compile output ---\n${compileOut}`);
        }
        await logger.log(this.i18n.t('builder.compile_finished'));
      } else {
        await logger.log(this.i18n.t('builder.compile_missing'));
      }

      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      const hasNexe = pkg.scripts && (pkg.scripts['nexe:win'] || pkg.scripts['nexe']);
      if (hasNexe) {
        const scriptName = pkg.scripts['nexe:win'] ? 'nexe:win' : 'nexe';
        const nexeCmd = usePnpm ? `pnpm run ${scriptName}` : `npm run ${scriptName}`;
        await logger.log(this.i18n.t('builder.nexe_running', { scriptName, cmd: nexeCmd }));
        await exec(nexeCmd, { cwd: repoDir, maxBuffer: 50 * 1024 * 1024 });
        await logger.log(this.i18n.t('builder.nexe_finished', { scriptName }));
      } else {
        await logger.log(this.i18n.t('builder.nexe_missing'));
      }

      const exePath = await this.findConfiguredExePath(repoDir, pkg);
      if (!exePath) {
        throw new Error(this.i18n.t('builder.exe_config_not_found'));
      }

      await logger.log(this.i18n.t('builder.exe_selected', { exePath }));

      const artifactFileName = this.getVersionedExecutableName(
        exePath,
        pkg.version,
      );

      const repoName = this.sanitizeSegment(repoInfo?.name ?? 'unknown');
      const refSegment = build.prNumber
        ? String(build.prNumber)
        : this.sanitizeSegment(build.ref || 'master');
      const artifactsDir =
        process.env.ARTIFACTS_DIR ?? path.join(process.cwd(), 'artifacts');
      const stagingDir = path.join(artifactsDir, repoName, build.id.toString());
      const stagingPath = path.join(stagingDir, artifactFileName);

      await fs.promises.mkdir(stagingDir, { recursive: true });
      await fs.promises.copyFile(exePath, stagingPath);
      await logger.log(this.i18n.t('builder.artifact_staged', { stagingPath }));

      const executablesDir = this.getExecutablesDir() || artifactsDir;
      const finalDir = path.join(executablesDir, repoName, refSegment);
      await fs.promises.mkdir(finalDir, { recursive: true });
      const finalPath = path.join(finalDir, artifactFileName);
      await fs.promises.copyFile(stagingPath, finalPath);
      await logger.log(this.i18n.t('builder.artifact_copied', { finalPath }));

      await this.removeDirIfExists(stagingDir);
      await logger.log(this.i18n.t('builder.staging_cleaned', { stagingDir }));

      await this.buildRepository.update(build.id, {
        status: BuildStatus.SUCCESS,
        artifactPath: finalPath,
      });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      await logger.error(this.i18n.t('builder.error', { error }));
      await this.buildRepository.update(build.id, {
        status: BuildStatus.FAILED,
      });
      this.logger.error(error);
    }
  }
}
