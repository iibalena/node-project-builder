import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
      repoId: number;
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
    if (!Number.isFinite(repoId)) {
      throw new BadRequestException(this.i18n.t('sync.invalid_repo_or_build'));
    }

    const repo = await this.repoRepository.findOne({
      where: { id: repoId, isActive: true },
    });

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
