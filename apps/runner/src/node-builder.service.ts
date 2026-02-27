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

  private parseOutputFromScript(script: string): string | null {
    const quoted = script.match(/(?:--output|-o)\s+["']([^"']+\.exe)["']/i);
    if (quoted?.[1]) return quoted[1];

    const plain = script.match(/(?:--output|-o)\s+([^\s"']+\.exe)/i);
    if (plain?.[1]) return plain[1];

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
        `Inicio do build id=${build.id} trigger=${build.trigger} ref=${build.ref}`,
      );
      const packageJsonPath = path.join(repoDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        await logger.log(
          `package.json nao encontrado em ${repoDir}, build ignorado.`,
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
      await logger.log(`Limpando pasta dist: ${distDir}`);
      await this.removeDirWithRetry(distDir);

      await logger.log(`Realizando comando de instalacao: ${installCmd}`);
      await exec(installCmd, { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 });
      await logger.log('Instalacao finalizada.');

      const buildCmd =
        repoInfo?.buildCommand ??
        (usePnpm ? 'pnpm run build' : 'npm run build');
      await logger.log(`Realizando build: ${buildCmd}`);
      await exec(buildCmd, { cwd: repoDir, maxBuffer: 20 * 1024 * 1024 });
      await logger.log('Build finalizado.');

      const compileScript = path.join(repoDir, 'scripts', 'compile.js');
      if (fs.existsSync(compileScript)) {
        await logger.log('Executando scripts/compile.js');
        await exec(`node ${path.relative(repoDir, compileScript)}`, {
          cwd: repoDir,
          maxBuffer: 20 * 1024 * 1024,
          timeout: this.getCompileTimeoutMs(),
        });
        await logger.log('compile.js finalizado.');
      } else {
        await logger.log('scripts/compile.js nao encontrado, etapa ignorada.');
      }

      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      const hasNexe = pkg.scripts && (pkg.scripts['nexe:win'] || pkg.scripts['nexe']);
      if (hasNexe) {
        const scriptName = pkg.scripts['nexe:win'] ? 'nexe:win' : 'nexe';
        const nexeCmd = usePnpm ? `pnpm run ${scriptName}` : `npm run ${scriptName}`;
        await logger.log(`Executando ${scriptName}: ${nexeCmd}`);
        await exec(nexeCmd, { cwd: repoDir, maxBuffer: 50 * 1024 * 1024 });
        await logger.log(`${scriptName} finalizado.`);
      } else {
        await logger.log('Script nexe nao encontrado no package.json, etapa ignorada.');
      }

      const exePath = await this.findConfiguredExePath(repoDir, pkg);
      if (!exePath) {
        throw new Error(
          'Executavel nao encontrado no caminho configurado (config.nexe.output ou script nexe/nexe:win com -o/--output).',
        );
      }

      await logger.log(`Executavel selecionado: ${exePath}`);

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
      await logger.log(`Artifact staged at ${stagingPath}`);

      const executablesDir = this.getExecutablesDir() || artifactsDir;
      const finalDir = path.join(executablesDir, repoName, refSegment);
      await fs.promises.mkdir(finalDir, { recursive: true });
      const finalPath = path.join(finalDir, artifactFileName);
      await fs.promises.copyFile(stagingPath, finalPath);
      await logger.log(`Artefato copiado para ${finalPath}`);

      await this.removeDirIfExists(stagingDir);
      await logger.log(`Pasta de staging limpa ${stagingDir}`);

      await this.buildRepository.update(build.id, {
        status: BuildStatus.SUCCESS,
        artifactPath: finalPath,
      });
    } catch (err: any) {
      await logger.error(`Erro no build: ${err?.message ?? String(err)}`);
      await this.buildRepository.update(build.id, {
        status: BuildStatus.FAILED,
      });
      this.logger.error(err?.message ?? String(err));
    }
  }
}
