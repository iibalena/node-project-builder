import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@shared/db/db.module';

import { RunnerService } from './runner.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuildEntity } from '@shared/db/entities/build.entity';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    TypeOrmModule.forFeature([BuildEntity]),
  ],
  controllers: [],
  providers: [RunnerService],
})
export class RunnerModule {}
