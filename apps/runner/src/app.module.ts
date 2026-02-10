import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RunnerController } from './runner.controller';
import { RunnerService } from './runner.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [RunnerController],
  providers: [RunnerService],
})
export class AppModule {}
