import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReposModule } from './repos/repos.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [ReposModule, WebhooksModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
