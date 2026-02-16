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
      pr?: number;
      ref?: string;
      force?: boolean;
    },
  ) {
    const repoId = Number(body.repoId);
    const prRaw = body.prNumber !== undefined ? body.prNumber : body.pr;
    const prNumber = prRaw !== undefined ? Number(prRaw) : undefined;

    if (!Number.isFinite(repoId)) {
      throw new BadRequestException('repoId must be a number');
    }

    return this.syncService.syncNow({
      repoId,
      prNumber: Number.isFinite(prNumber) ? prNumber : undefined,
      ref: body.ref,
      force: body.force === true,
    });
  }
}
