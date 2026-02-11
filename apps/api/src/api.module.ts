import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@shared/db/db.module';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { ReposModule } from './repos/repos.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BuildsModule } from './builds/builds.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,

    ReposModule,
    WebhooksModule,
    BuildsModule,
  ],
  controllers: [ApiController],
  providers: [ApiService],
})
export class ApiModule {}
