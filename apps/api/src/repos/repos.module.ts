import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { ReposController } from './repos.controller';
import { ReposService } from './repos.service';
import { GitHubRepoService } from './github-repo.service';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [TypeOrmModule.forFeature([RepoEntity]), SyncModule],
  controllers: [ReposController],
  providers: [ReposService, GitHubRepoService],
})
export class ReposModule {}
