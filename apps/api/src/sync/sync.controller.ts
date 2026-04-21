import { Body, Controller, Post } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncNowDto } from './dto/sync-now.dto';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('now')
  async syncNow(@Body() body: SyncNowDto) {
    const prNumber = body.prNumber ?? body.pr;
    return this.syncService.syncNow({
      repoId: body.repoId,
      repo: body.repo,
      prNumber,
      ref: body.ref,
      force: body.force === true,
    });
  }
}
