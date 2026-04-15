import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { BuildEntity, BuildStatus } from '../../shared/src/db/entities/build.entity';
import { RepoEntity } from '../../shared/src/db/entities/repo.entity';
import { I18nService } from '../../shared/src/i18n/i18n.service';
import { BuildLogger } from './build-logger';

const exec = promisify(_exec);

@Injectable()
export class FlutterBuilderService {
  private readonly logger = new Logger(FlutterBuilderService.name);

  private readonly androidKeyPropertiesFile = 'key.properties';

  private readonly flutterExecutableName =
    process.platform === 'win32' ? 'flutter.bat' : 'flutter';

  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    private readonly i18n: I18nService,
  ) {}

  private getFlutterBin() {
    return (process.env.FLUTTER_BIN ?? 'flutter').trim() || 'flutter';
  }

  private async resolveFlutterBin(repoDir: string, logger: BuildLogger) {
    const defaultFlutterBin = this.getFlutterBin();

    // 1) Prefer local FVM SDK when present in repo.
    const localFvmFlutterBin = path.join(
      repoDir,
      '.fvm',
      'flutter_sdk',
      'bin',
      this.flutterExecutableName,
    );
    if (await this.pathExists(localFvmFlutterBin)) {
      await logger.log(
        this.i18n.t('builder.flutter_fvm_local_sdk_detected', {
          flutterBin: localFvmFlutterBin,
        }),
      );
      return localFvmFlutterBin;
    }

    const fvmRcPath = path.join(repoDir, '.fvmrc');
    if (!(await this.pathExists(fvmRcPath))) {
      await logger.log(
        this.i18n.t('builder.flutter_bin_selected', {
          flutterBin: defaultFlutterBin,
        }),
      );
      return defaultFlutterBin;
    }

    let requestedVersion = '';
    try {
      const content = await fs.promises.readFile(fvmRcPath, 'utf8');
      const parsed = JSON.parse(content) as { flutter?: string };
      requestedVersion = String(parsed.flutter ?? '').trim();
    } catch {
      await logger.log(
        this.i18n.t('builder.flutter_bin_selected', {
          flutterBin: defaultFlutterBin,
        }),
      );
      return defaultFlutterBin;
    }

    if (!requestedVersion) {
      await logger.log(
        this.i18n.t('builder.flutter_bin_selected', {
          flutterBin: defaultFlutterBin,
        }),
      );
      return defaultFlutterBin;
    }

    await logger.log(
      this.i18n.t('builder.flutter_fvm_version_detected', {
        version: requestedVersion,
      }),
    );

    const userProfile = process.env.USERPROFILE ?? '';
    const fvmHome = process.env.FVM_HOME ?? '';
    const flutterSdksDir = process.env.FLUTTER_SDKS_DIR ?? '';
    const fvmVersionsDir = process.env.FVM_VERSIONS_DIR ?? '';

    const candidateRoots = [
      flutterSdksDir,
      fvmVersionsDir,
      fvmHome ? path.join(fvmHome, 'versions') : '',
      userProfile ? path.join(userProfile, 'fvm', 'versions') : '',
      'C:\\fvm\\versions',
      'C:\\builder\\sdk\\flutter_versions',
    ].filter((value) => value.trim().length > 0);

    for (const root of candidateRoots) {
      const candidate = path.join(
        root,
        requestedVersion,
        'bin',
        this.flutterExecutableName,
      );
      if (await this.pathExists(candidate)) {
        await logger.log(
          this.i18n.t('builder.flutter_fvm_version_sdk_selected', {
            version: requestedVersion,
            flutterBin: candidate,
          }),
        );
        return candidate;
      }
    }

    await logger.log(
      this.i18n.t('builder.flutter_fvm_version_not_found', {
        version: requestedVersion,
        fallback: defaultFlutterBin,
      }),
    );
    await logger.log(
      this.i18n.t('builder.flutter_bin_selected', {
        flutterBin: defaultFlutterBin,
      }),
    );
    return defaultFlutterBin;
  }

  private sanitizeEnvValue(value: string) {
    return value.replace(/\r?\n/g, '').trim();
  }

  private getAndroidSigningConfig() {
    const keystorePath = this.sanitizeEnvValue(
      process.env.ANDROID_KEYSTORE_PATH ?? '',
    );
    const storePassword = this.sanitizeEnvValue(
      process.env.ANDROID_KEYSTORE_STORE_PASSWORD ?? '',
    );
    const keyAlias = this.sanitizeEnvValue(
      process.env.ANDROID_KEYSTORE_KEY_ALIAS ?? '',
    );
    const keyPassword = this.sanitizeEnvValue(
      process.env.ANDROID_KEYSTORE_KEY_PASSWORD ?? '',
    );

    const values = [keystorePath, storePassword, keyAlias, keyPassword];
    const filledCount = values.filter((value) => value.length > 0).length;

    if (filledCount === 0) {
      return null;
    }

    if (filledCount !== values.length) {
      throw new Error(this.i18n.t('builder.flutter_signing_env_incomplete'));
    }

    return {
      keystorePath,
      storePassword,
      keyAlias,
      keyPassword,
    };
  }

  private shouldRunFlutterTests() {
    return String(process.env.FLUTTER_RUN_TESTS ?? 'false').toLowerCase() === 'true';
  }

  private sanitizeSegment(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, '-').trim();
  }

  private getArtifactsRoot() {
    return process.env.ARTIFACTS_DIR ?? path.join(process.cwd(), 'artifacts');
  }

  private async pathExists(filePath: string) {
    return fs.promises
      .access(filePath)
      .then(() => true)
      .catch(() => false);
  }

  private async findArtifactsByExtension(rootDir: string, extension: string): Promise<string[]> {
    if (!(await this.pathExists(rootDir))) {
      return [];
    }

    const matches: string[] = [];
    const visit = async (currentDir: string) => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
          matches.push(fullPath);
        }
      }
    };

    await visit(rootDir);
    return matches;
  }

  private extractAndroidAppId(content: string): string | null {
    const patterns = [
      /applicationId\s*[= ]\s*["']([A-Za-z0-9_.]+)["']/,
      /namespace\s*[= ]\s*["']([A-Za-z0-9_.]+)["']/,
      /package\s*=\s*["']([A-Za-z0-9_.]+)["']/, // AndroidManifest.xml
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  private extractIosBundleId(content: string): string | null {
    const pbxprojMatch = content.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/);
    if (pbxprojMatch?.[1]) {
      const value = pbxprojMatch[1].trim().replace(/['"]/g, '');
      if (value && !value.includes('$(')) {
        return value;
      }
    }

    const xcconfigMatch = content.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^\r\n]+)/);
    if (xcconfigMatch?.[1]) {
      const value = xcconfigMatch[1].trim().replace(/['"]/g, '');
      if (value && !value.includes('$(')) {
        return value;
      }
    }

    return null;
  }

  private async detectBundleIds(repoDir: string) {
    const androidCandidates = [
      path.join(repoDir, 'android', 'app', 'build.gradle'),
      path.join(repoDir, 'android', 'app', 'build.gradle.kts'),
      path.join(repoDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    ];

    let androidAppId: string | null = null;
    for (const candidate of androidCandidates) {
      if (!(await this.pathExists(candidate))) {
        continue;
      }
      const content = await fs.promises.readFile(candidate, 'utf8');
      androidAppId = this.extractAndroidAppId(content);
      if (androidAppId) {
        break;
      }
    }

    const iosCandidates = [
      path.join(repoDir, 'ios', 'Runner.xcodeproj', 'project.pbxproj'),
      path.join(repoDir, 'ios', 'Flutter', 'Release.xcconfig'),
      path.join(repoDir, 'ios', 'Flutter', 'Debug.xcconfig'),
    ];

    let iosBundleId: string | null = null;
    for (const candidate of iosCandidates) {
      if (!(await this.pathExists(candidate))) {
        continue;
      }
      const content = await fs.promises.readFile(candidate, 'utf8');
      iosBundleId = this.extractIosBundleId(content);
      if (iosBundleId) {
        break;
      }
    }

    return { androidAppId, iosBundleId };
  }

  private async selectNewestArtifact(rootDir: string, extension: string) {
    const candidates = await this.findArtifactsByExtension(rootDir, extension);
    if (candidates.length === 0) {
      return null;
    }

    const filesWithStats = await Promise.all(
      candidates.map(async (filePath) => ({
        filePath,
        stat: await fs.promises.stat(filePath),
      })),
    );

    filesWithStats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
    return filesWithStats[0]?.filePath ?? null;
  }

  private async runCommand(
    logger: BuildLogger,
    repoDir: string,
    command: string,
    outputLabel: string,
    maxBuffer = 50 * 1024 * 1024,
  ) {
    const result = await exec(command, { cwd: repoDir, maxBuffer });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (output) {
      await logger.log(`--- ${outputLabel} ---\n${output}`);
    }
  }

  private async prepareAndroidSigning(
    repoDir: string,
    logger: BuildLogger,
  ): Promise<{
    keyPropertiesPath: string;
  } | null> {
    const signing = this.getAndroidSigningConfig();
    if (!signing) {
      await logger.log(this.i18n.t('builder.flutter_signing_env_not_configured'));
      return null;
    }

    const resolvedKeystorePath = path.resolve(signing.keystorePath);
    if (!(await this.pathExists(resolvedKeystorePath))) {
      throw new Error(
        this.i18n.t('builder.flutter_keystore_not_found', {
          path: resolvedKeystorePath,
        }),
      );
    }

    const androidDir = path.join(repoDir, 'android');
    await fs.promises.mkdir(androidDir, { recursive: true });
    const keyPropertiesPath = path.join(androidDir, this.androidKeyPropertiesFile);

    const keyPropertiesContent = [
      `storePassword=${signing.storePassword}`,
      `keyPassword=${signing.keyPassword}`,
      `keyAlias=${signing.keyAlias}`,
      `storeFile=${signing.keystorePath}`,
      '',
    ].join('\n');

    await fs.promises.writeFile(keyPropertiesPath, keyPropertiesContent, 'utf8');
    await logger.log(
      this.i18n.t('builder.flutter_key_properties_written', {
        keyPropertiesPath,
      }),
    );

    return { keyPropertiesPath };
  }

  async build(build: BuildEntity, repoDir: string) {
    const logger = new BuildLogger(
      build.id,
      this.buildRepository,
      build.prNumber,
      build.ref,
      this.logger,
    );
    let signingContext: {
      keyPropertiesPath: string;
    } | null = null;

    try {
      await logger.log(
        this.i18n.t('builder.start', {
          id: build.id,
          trigger: build.trigger,
          ref: build.ref,
        }),
      );

      const repo = build.repo as RepoEntity | undefined;
      const flutterBin = await this.resolveFlutterBin(repoDir, logger);
      const entryPoint = 'lib/main.dart';

      if (!(await this.pathExists(path.join(repoDir, 'pubspec.yaml')))) {
        throw new Error(this.i18n.t('builder.flutter_pubspec_missing', { repoDir }));
      }

      if (!(await this.pathExists(path.join(repoDir, entryPoint)))) {
        throw new Error(
          this.i18n.t('builder.flutter_entry_point_missing', { entryPoint }),
        );
      }

      const pubGetCommand = `${flutterBin} pub get`;
      await logger.log(this.i18n.t('builder.flutter_pub_get_running', { cmd: pubGetCommand }));
      await this.runCommand(logger, repoDir, pubGetCommand, 'flutter pub get output');
      await logger.log(this.i18n.t('builder.flutter_pub_get_finished'));

      signingContext = await this.prepareAndroidSigning(repoDir, logger);

      if (this.shouldRunFlutterTests()) {
        const testCommand = `${flutterBin} test`;
        await logger.log(this.i18n.t('builder.flutter_test_running', { cmd: testCommand }));
        await this.runCommand(logger, repoDir, testCommand, 'flutter test output');
        await logger.log(this.i18n.t('builder.flutter_test_finished'));
      } else {
        await logger.log(this.i18n.t('builder.flutter_test_skipped'));
      }

      const buildOutputsRoot = path.join(repoDir, 'build', 'app', 'outputs');
      await fs.promises.rm(buildOutputsRoot, { recursive: true, force: true });

      const appbundleCommand = `${flutterBin} build appbundle --release --target ${JSON.stringify(entryPoint)}`;
      await logger.log(this.i18n.t('builder.flutter_appbundle_running', { cmd: appbundleCommand }));
      await this.runCommand(logger, repoDir, appbundleCommand, 'flutter build appbundle output');
      await logger.log(this.i18n.t('builder.flutter_appbundle_finished'));

      const appBundlePath = await this.selectNewestArtifact(
        path.join(buildOutputsRoot, 'bundle'),
        '.aab',
      );

      if (!appBundlePath) {
        throw new Error(this.i18n.t('builder.flutter_appbundle_not_found'));
      }

      const repoName = this.sanitizeSegment(repo?.name ?? 'unknown');
      const refSegment = build.prNumber
        ? String(build.prNumber)
        : this.sanitizeSegment(build.ref || 'master');
      const finalDir = path.join(this.getArtifactsRoot(), repoName, refSegment, 'android');
      await fs.promises.mkdir(finalDir, { recursive: true });

      const finalPath = path.join(finalDir, path.basename(appBundlePath));
      await fs.promises.copyFile(appBundlePath, finalPath);
      await logger.log(
        this.i18n.t('builder.flutter_artifact_copied', {
          artifactType: 'appbundle',
          finalPath,
        }),
      );

      if (repo?.id) {
        const detectedIds = await this.detectBundleIds(repoDir);
        const nextAndroidAppId = detectedIds.androidAppId ?? null;
        const nextIosBundleId = detectedIds.iosBundleId ?? null;

        if (
          nextAndroidAppId !== (repo.androidAppId ?? null) ||
          nextIosBundleId !== (repo.iosBundleId ?? null)
        ) {
          await this.repoRepository.update(repo.id, {
            androidAppId: nextAndroidAppId,
            iosBundleId: nextIosBundleId,
          });
        }

        await logger.log(
          this.i18n.t('builder.flutter_bundle_ids_detected', {
            androidAppId: nextAndroidAppId ?? 'n/a',
            iosBundleId: nextIosBundleId ?? 'n/a',
          }),
        );
      }

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
    } finally {
      void signingContext;
    }
  }
}