import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuildEntity, BuildStatus } from '@shared/db/entities/build.entity';

@Injectable()
export class RunnerService implements OnModuleInit {
  private readonly logger = new Logger(RunnerService.name);
  private interval: NodeJS.Timeout;

  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
  ) {}

  onModuleInit() {
    const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 3000);

    this.logger.log(`Runner polling every ${intervalMs}ms`);

    this.interval = setInterval(() => {
      this.processNextBuild().catch((err) =>
        this.logger.error(err),
      );
    }, intervalMs);
  }

  async processNextBuild() {
    const build = await this.buildRepository.findOne({
      where: { status: BuildStatus.QUEUED },
      order: { createdAt: 'ASC' },
    });

    if (!build) return;

    this.logger.log(`Picked build ${build.id}`);

    build.status = BuildStatus.RUNNING;
    await this.buildRepository.save(build);

    this.logger.log(`Build ${build.id} marked as RUNNING`);
  }
}
