import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RunnerController } from './runner.controller';
import { RunnerService } from './runner.service';
import { DbModule } from '@shared/db/db.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DbModule,
  ],
  controllers: [RunnerController],
  providers: [RunnerService],
})
export class AppModule {}
