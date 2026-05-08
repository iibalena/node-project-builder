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
import { setupNpmAuthEnv } from './npm-auth.util';
import { ensureNodeVersion } from './node-version.util';

const exec = promisify(_exec);

@Injectable()
export class AngularBuilderService {
  private readonly logger = new Logger(AngularBuilderService.name);

  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    private readonly i18n: I18nService,
  ) {}

  private sanitizeSegment(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, '-').trim();
  }

  private getArtifactsRoot() {
    return process.env.ARTIFACTS_DIR ?? path.join(process.cwd(), 'artifacts');
  }

  private getExecutablesDir() {
    return process.env.EXECUTABLES_DIR ?? '';
  }

  private getMasterExecutablesDir() {
    return process.env.MASTER_EXECUTABLES_DIR ?? '';
  }

  private async copyRootExampleFilesToDir(
    repoDir: string,
    targetDir: string,
    logger: BuildLogger,
  ) {
    const rootEntries = await fs.promises.readdir(repoDir, {
      withFileTypes: true,
    });
    const exampleFiles = rootEntries.filter(
      (entry) => entry.isFile() && /\.example$/i.test(entry.name),
    );

    if (exampleFiles.length === 0) {
      return;
    }

    await fs.promises.mkdir(targetDir, { recursive: true });

    for (const file of exampleFiles) {
      const sourcePath = path.join(repoDir, file.name);
      const destinationPath = path.join(targetDir, file.name);
      await fs.promises.copyFile(sourcePath, destinationPath);
    }

    await logger.log(
      `Copied ${exampleFiles.length} *.example file(s) to ${targetDir}`,
    );
  }

  private getAngularDistOutputPath(repoDir: string): string {
    const angularJsonPath = path.join(repoDir, 'angular.json');
    if (!fs.existsSync(angularJsonPath)) {
      return path.join(repoDir, 'dist');
    }

    try {
      const angularJson = JSON.parse(fs.readFileSync(angularJsonPath, 'utf8'));
      const defaultProject = String(angularJson?.defaultProject ?? '').trim();
      const projectKey =
        defaultProject ||
        Object.keys(angularJson?.projects ?? {})[0] ||
        '';

      const options = angularJson?.projects?.[projectKey]?.architect?.build?.options;
      const outputPath = options?.outputPath;

      if (typeof outputPath === 'string' && outputPath.trim()) {
        return path.resolve(repoDir, outputPath.trim());
      }

      if (outputPath && typeof outputPath === 'object') {
        const base = String(outputPath.base ?? '').trim();
        if (base) {
          const browser = String(outputPath.browser ?? '').trim();
          return path.resolve(repoDir, browser ? path.join(base, browser) : base);
        }
      }
    } catch {
      return path.join(repoDir, 'dist');
    }

    return path.join(repoDir, 'dist');
  }

  async build(
    build: BuildEntity,
    repoDir: string,
    repoOwner?: string,
    repoName?: string,
  ) {
    const logger = new BuildLogger(
      build.id,
      this.buildRepository,
      build.prNumber,
      build.ref,
      this.logger,
      repoOwner,
      repoName,
    );

    let npmAuthCleanup: (() => Promise<void>) | null = null;

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

      const useLegacy = repoInfo?.useLegacyPeerDeps === true;
      if (useLegacy && installCmd.startsWith('npm')) {
        installCmd = `${installCmd} --legacy-peer-deps`;
      }

      const distDir = path.join(repoDir, 'dist');
      await logger.log(this.i18n.t('builder.clean_dist', { distDir }));
      await fs.promises.rm(distDir, { recursive: true, force: true });

      const npmAuth = await setupNpmAuthEnv({ repoInfo });
      npmAuthCleanup = npmAuth.cleanup;
      const runtimeEnv = await ensureNodeVersion(
        repoInfo?.nodeVersion,
        npmAuth.env,
        logger,
      );
      if (npmAuth.enabled) {
        await logger.log(
          `NPM auth enabled via ${npmAuth.tokenSource} for scopes: ${npmAuth.scopes.join(', ')}`,
        );
      }

      await logger.log(
        this.i18n.t('builder.install_running', { cmd: installCmd }),
      );
      await exec(installCmd, {
        cwd: repoDir,
        env: runtimeEnv,
        maxBuffer: 20 * 1024 * 1024,
      });
      await logger.log(this.i18n.t('builder.install_finished'));

      const buildCmd = usePnpm ? 'pnpm run build' : 'npm run build';
      await logger.log(this.i18n.t('builder.build_running', { cmd: buildCmd }));
      await exec(buildCmd, {
        cwd: repoDir,
        env: runtimeEnv,
        maxBuffer: 30 * 1024 * 1024,
      });
      await logger.log(this.i18n.t('builder.build_finished'));

      const outputDir = this.getAngularDistOutputPath(repoDir);
      const outputExists = await fs.promises
        .access(outputDir)
        .then(() => true)
        .catch(() => false);

      if (!outputExists) {
        throw new Error(
          this.i18n.t('builder.angular_output_not_found', { outputDir }),
        );
      }

      await logger.log(
        this.i18n.t('builder.angular_output_selected', { outputDir }),
      );

      const repoName = this.sanitizeSegment(repoInfo?.name ?? 'unknown');
      const refSegment = build.prNumber
        ? String(build.prNumber)
        : this.sanitizeSegment(build.ref || 'master');

      const isMasterBuild = refSegment === 'master' && !build.prNumber;
      const masterExecutablesDir = this.getMasterExecutablesDir();
      const baseDir =
        isMasterBuild && masterExecutablesDir
          ? masterExecutablesDir
          : this.getArtifactsRoot();

      const masterProjectDir = path.join(baseDir, repoName);
      const finalDir = isMasterBuild
        ? path.join(masterProjectDir, 'dist')
        : path.join(baseDir, repoName, refSegment, 'dist');
      await fs.promises.mkdir(path.dirname(finalDir), { recursive: true });
      await fs.promises.rm(finalDir, { recursive: true, force: true });
      await fs.promises.cp(outputDir, finalDir, { recursive: true });

      await logger.log(
        this.i18n.t('builder.angular_artifact_copied', { finalDir }),
      );

      if (isMasterBuild && masterExecutablesDir) {
        await this.copyRootExampleFilesToDir(repoDir, masterProjectDir, logger);
      }

      await this.buildRepository.update(build.id, {
        status: BuildStatus.SUCCESS,
        artifactPath: finalDir,
      });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      await logger.error(this.i18n.t('builder.error', { error }));
      await this.buildRepository.update(build.id, {
        status: BuildStatus.FAILED,
      });
      this.logger.error(error);
    } finally {
      if (npmAuthCleanup) {
        await npmAuthCleanup();
      }
    }
  }
}
