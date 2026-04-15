import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';
import { BuildEntity } from '../../../shared/src/db/entities/build.entity';
import { PublicationEntity } from '../../../shared/src/db/entities/publication.entity';
import { VersionCodeStateEntity } from '../../../shared/src/db/entities/version-code-state.entity';
import { RepoEntity } from '../../../shared/src/db/entities/repo.entity';
import { I18nModule } from '../../../shared/src/i18n/i18n.module';
import { GooglePlayPublisherService } from './google-play-publisher.service';

@Module({
  imports: [
    I18nModule,
    TypeOrmModule.forFeature([
      BuildEntity,
      RepoEntity,
      PublicationEntity,
      VersionCodeStateEntity,
    ]),
  ],
  controllers: [PublicationsController],
  providers: [PublicationsService, GooglePlayPublisherService],
})
export class PublicationsModule {}
