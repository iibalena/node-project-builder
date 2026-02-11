import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuildEntity } from '@shared/db/entities/build.entity';
import { BuildsController } from './builds.controller';
import { BuildsService } from './builds.service';

@Module({
  imports: [TypeOrmModule.forFeature([BuildEntity])],
  controllers: [BuildsController],
  providers: [BuildsService],
})
export class BuildsModule {}
