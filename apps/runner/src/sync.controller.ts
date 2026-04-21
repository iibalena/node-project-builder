import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { RepoEntity } from '../../shared/src/db/entities/repo.entity';
import { BuildSyncService } from './build-sync.service';
import { RunnerService } from './runner.service';
import { I18nService } from '../../shared/src/i18n/i18n.service';

@Controller('sync')
export class SyncController {
  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    private readonly buildSync: BuildSyncService,
    private readonly runnerService: RunnerService,
    private readonly i18n: I18nService,
  ) {}

  @Post('now')
  async syncNow(
    @Body()
    body: {
      buildId?: number;
      repoId?: number;
      repo?: string;
      prNumber?: number;
      ref?: string;
      force?: boolean;
    },
  ) {
    const buildId = Number(body.buildId);
    if (Number.isFinite(buildId)) {
      return this.runnerService.processBuildById(buildId);
    }

    const repoId = Number(body.repoId);
    const repoRaw = String(body.repo ?? '').trim();

    let repo: RepoEntity | null = null;
    if (Number.isFinite(repoId)) {
      repo = await this.repoRepository.findOne({
        where: { id: repoId, isActive: true },
      });
    } else if (repoRaw) {
      if (repoRaw.includes('/')) {
        const [owner, name] = repoRaw.split('/', 2);
        repo = await this.repoRepository.findOne({
          where: { owner, name, isActive: true },
        });
      } else {
        const matches = await this.repoRepository.find({
          where: { name: ILike(repoRaw), isActive: true },
          order: { id: 'DESC' },
          take: 2,
        });

        if (matches.length > 1) {
          throw new BadRequestException(
            `Multiple active repositories matched name '${repoRaw}'. Use owner/name or repoId.`,
          );
        }

        repo = matches[0] ?? null;
      }
    } else {
      throw new BadRequestException(this.i18n.t('sync.invalid_repo_or_build'));
    }

    if (!repo) {
      throw new NotFoundException(this.i18n.t('sync.repo_not_found'));
    }

    return this.buildSync.syncSelection({
      repo,
      prNumber: body.prNumber,
      ref: body.ref,
      force: body.force === true,
    });
  }

  @Post('repo')
  async syncRepo(
    @Body()
    body: {
      repoId: number;
    },
  ) {
    const repo = await this.repoRepository.findOne({
      where: { id: body.repoId, isActive: true },
    });

    if (!repo) {
      throw new NotFoundException(this.i18n.t('sync.repo_not_found'));
    }

    await this.buildSync.syncRepo(repo, { ignoreCooldown: true });
    return { ok: true };
  }
}
