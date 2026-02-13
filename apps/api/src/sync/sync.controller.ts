import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('now')
  async syncNow(
    @Body()
    body: {
      repoId: number;
      prNumber?: number;
      ref?: string;
    },
  ) {
    const repoId = Number(body.repoId);
    const prNumber = body.prNumber !== undefined ? Number(body.prNumber) : undefined;

    if (!Number.isFinite(repoId)) {
      throw new BadRequestException('repoId must be a number');
    }

    return this.syncService.syncNow({
      repoId,
      prNumber: Number.isFinite(prNumber) ? prNumber : undefined,
      ref: body.ref,
    });
  }
}
