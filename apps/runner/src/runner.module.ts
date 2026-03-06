import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@shared/db/db.module';

import { RunnerService } from './runner.service';
import { BuildPreparationService } from './build-prep.service';
import { NodeBuilderService } from './node-builder.service';
import { AngularBuilderService } from './angular-builder.service';
import { GitHubService } from './github.service';
import { BuildSyncService } from './build-sync.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuildEntity } from '@shared/db/entities/build.entity';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { BuildRefStateEntity } from '@shared/db/entities/build-ref-state.entity';
import { SyncController } from './sync.controller';
import { I18nModule } from '@shared/i18n/i18n.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    I18nModule,
    TypeOrmModule.forFeature([BuildEntity, RepoEntity, BuildRefStateEntity]),
  ],
  controllers: [SyncController],
  providers: [
    RunnerService,
    BuildPreparationService,
    NodeBuilderService,
    AngularBuilderService,
    GitHubService,
    BuildSyncService,
  ],
})
export class RunnerModule {}
