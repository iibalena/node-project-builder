import { Controller, Get, Query } from '@nestjs/common';
import { BuildsService } from './builds.service';

@Controller('builds')
export class BuildsController {
  constructor(private readonly buildsService: BuildsService) {}

  @Get()
  async list(
    @Query('repoId') repoId?: string,
    @Query('status') status?: string,
  ) {
    const parsedRepoId = repoId ? Number(repoId) : undefined;
    return this.buildsService.list({
      repoId: Number.isFinite(parsedRepoId) ? parsedRepoId : undefined,
      status,
    });
  }
}
