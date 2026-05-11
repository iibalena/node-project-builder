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
export class JavaBuilderService {
  private readonly logger = new Logger(JavaBuilderService.name);

  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    private readonly i18n: I18nService,
  ) {}

  private getArtifactsRoot() {
    return process.env.ARTIFACTS_DIR ?? path.join(process.cwd(), 'artifacts');
  }

  private getExecutablesDir() {
    return process.env.EXECUTABLES_DIR ?? '';
  }

  private getMasterExecutablesDir() {
    return process.env.MASTER_EXECUTABLES_DIR ?? '';
  }

  private sanitizeSegment(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, '-').trim();
  }

  private async removeDirIfExists(dir: string) {
    try {
      await fs.promises.access(dir);
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist, nothing to do
    }
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

  private getJavaVersionFromDotFile(repoDir: string): string | null {
    try {
      const javaVersionPath = path.join(repoDir, '.java-version');
      if (fs.existsSync(javaVersionPath)) {
        const content = fs.readFileSync(javaVersionPath, 'utf-8').trim();
        return content || null;
      }
    } catch (err) {
      // Ignore errors reading .java-version file
    }
    return null;
  }

  private getMavenCommand(repoDir: string): string {
    // Prefer repo-local Maven wrapper if available
    const wrapper = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
    const wrapperPath = path.join(repoDir, wrapper);
    if (fs.existsSync(wrapperPath)) {
      return wrapperPath;
    }

    // Fall back to MAVEN_HOME or M2_HOME if configured
    const mavenHome = String(process.env.MAVEN_HOME ?? process.env.M2_HOME ?? '').trim();
    if (mavenHome) {
      const mvnCmd = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
      const candidate = path.join(mavenHome, 'bin', mvnCmd);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      return candidate; // still return candidate so error is more explicit than plain 'mvn'
    }

    // Fall back to system Maven on PATH
    return process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  }

  async build(
    build: BuildEntity,
    repoDir: string,
    repoOwner: string,
    repoName: string,
  ): Promise<void> {
    const logger = new BuildLogger(
      build.id,
      this.buildRepository,
      build.prNumber,
      build.ref,
      this.logger,
      repoOwner,
      repoName,
    );

    try {
      await logger.log(this.i18n.t('builder.java_build_start'));

      // Check for pom.xml
      const pomPath = path.join(repoDir, 'pom.xml');
      if (!fs.existsSync(pomPath)) {
        throw new Error(this.i18n.t('builder.java_no_pom'));
      }

      // Get Java version from .java-version file if available
      const javaVersionFromFile = this.getJavaVersionFromDotFile(repoDir);
      if (javaVersionFromFile) {
        await logger.log(`Java version from .java-version: ${javaVersionFromFile}`);
      }

      // Determine Maven command
      const mvnCmd = this.getMavenCommand(repoDir);
      await logger.log(`Using Maven command: ${mvnCmd}`);

      // Clean and compile
      const cleanCmd = `${mvnCmd} clean`;
      await logger.log(this.i18n.t('builder.java_clean_running', { cmd: cleanCmd }));
      await exec(cleanCmd, {
        cwd: repoDir,
        maxBuffer: 20 * 1024 * 1024,
      });
      await logger.log(this.i18n.t('builder.java_clean_finished'));

      // Package
      const packageCmd = `${mvnCmd} package -DskipTests`;
      await logger.log(this.i18n.t('builder.java_package_running', { cmd: packageCmd }));
      await exec(packageCmd, {
        cwd: repoDir,
        maxBuffer: 30 * 1024 * 1024,
      });
      await logger.log(this.i18n.t('builder.java_package_finished'));

      // Find the generated JAR file
      const targetDir = path.join(repoDir, 'target');
      const jarFiles = await fs.promises.readdir(targetDir).then(entries =>
        entries.filter(entry => entry.endsWith('.jar') && !entry.includes('-javadoc') && !entry.includes('-sources'))
      );

      if (jarFiles.length === 0) {
        throw new Error(this.i18n.t('builder.java_no_jar_found'));
      }

      // Use the first JAR file found (typically the main artifact)
      const jarFileName = jarFiles[0];
      const jarPath = path.join(targetDir, jarFileName);

      await logger.log(`Found JAR file: ${jarFileName}`);

      // Copy to artifacts/executables
      const repoNameSegment = this.sanitizeSegment(repoName);
      const refSegment = build.prNumber
        ? String(build.prNumber)
        : this.sanitizeSegment(build.ref || 'master');

      const isMasterBuild = refSegment === 'master' && !build.prNumber;
      const masterExecutablesDir = this.getMasterExecutablesDir();
      const baseExecutablesDir =
        isMasterBuild && masterExecutablesDir
          ? masterExecutablesDir
          : this.getExecutablesDir() || this.getArtifactsRoot();

      const finalDir = isMasterBuild
        ? path.join(baseExecutablesDir, repoNameSegment)
        : path.join(baseExecutablesDir, repoNameSegment, refSegment);

      await fs.promises.mkdir(finalDir, { recursive: true });
      const finalPath = path.join(finalDir, jarFileName);
      await fs.promises.copyFile(jarPath, finalPath);
      await logger.log(this.i18n.t('builder.java_artifact_copied', { finalPath }));

      if (isMasterBuild && masterExecutablesDir) {
        await this.copyRootExampleFilesToDir(repoDir, finalDir, logger);
      }

      await this.buildRepository.update(build.id, {
        status: BuildStatus.SUCCESS,
        artifactPath: finalPath,
      });

      await logger.log(this.i18n.t('builder.java_build_success'));

    } catch (err: any) {
      const error = err?.message ?? String(err);
      await logger.error(this.i18n.t('builder.java_build_failed', { error }));
      await this.buildRepository.update(build.id, {
        status: BuildStatus.FAILED,
      });
      throw err;
    }
  }
}