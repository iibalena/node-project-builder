import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { ReposController } from './repos.controller';
import { ReposService } from './repos.service';

@Module({
  imports: [TypeOrmModule.forFeature([RepoEntity])],
  controllers: [ReposController],
  providers: [ReposService],
})
export class ReposModule {}
