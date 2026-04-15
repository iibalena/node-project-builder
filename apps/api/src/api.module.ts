import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../../shared/src/db/db.module';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { ReposModule } from './repos/repos.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BuildsModule } from './builds/builds.module';
import { SyncModule } from './sync/sync.module';
import { PublicationsModule } from './publications/publications.module';
import { I18nModule } from '../../shared/src/i18n/i18n.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    I18nModule,

    ReposModule,
    WebhooksModule,
    BuildsModule,
    SyncModule,
    PublicationsModule,
  ],
  controllers: [ApiController],
  providers: [ApiService],
})
export class ApiModule {}
