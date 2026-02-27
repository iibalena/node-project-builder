import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { BuildSyncService } from './build-sync.service';
import { RunnerService } from './runner.service';

@Controller('sync')
export class SyncController {
  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    private readonly buildSync: BuildSyncService,
    private readonly runnerService: RunnerService,
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
      throw new BadRequestException('repoId ou buildId deve ser informado');
    }

    const repo = await this.repoRepository.findOne({
      where: { id: repoId, isActive: true },
    });

    if (!repo) {
      throw new NotFoundException('repo_not_found');
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
      throw new NotFoundException('repo_not_found');
    }

    await this.buildSync.syncRepo(repo, { ignoreCooldown: true });
    return { ok: true };
  }
}
