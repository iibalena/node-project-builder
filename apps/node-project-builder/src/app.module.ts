import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReposModule } from './repos/repos.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BuildsModule } from './builds/builds.module';

@Module({
  imports: [ReposModule, WebhooksModule, BuildsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
