import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { BuildEntity } from '@shared/db/entities/build.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [TypeOrmModule.forFeature([RepoEntity, BuildEntity])],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
