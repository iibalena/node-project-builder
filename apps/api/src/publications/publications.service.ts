import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { BuildEntity, BuildStatus } from '../../../shared/src/db/entities/build.entity';
import {
  PublicationEntity,
  PublicationPlatform,
  PublicationProvider,
  PublicationStatus,
} from '../../../shared/src/db/entities/publication.entity';
import { VersionCodeStateEntity } from '../../../shared/src/db/entities/version-code-state.entity';
import { PlanPublicationDto } from './dto/plan-publication.dto';
import { CreatePublicationDto } from './dto/create-publication.dto';
import { UpdatePublicationStatusDto } from './dto/update-publication-status.dto';
import { ListPublicationsDto } from './dto/list-publications.dto';
import { I18nService } from '../../../shared/src/i18n/i18n.service';

@Injectable()
export class PublicationsService {
  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    @InjectRepository(PublicationEntity)
    private readonly publicationRepository: Repository<PublicationEntity>,
    @InjectRepository(VersionCodeStateEntity)
    private readonly versionCodeStateRepository: Repository<VersionCodeStateEntity>,
    private readonly dataSource: DataSource,
    private readonly i18n: I18nService,
  ) {}

  private normalizeTrack(track?: string) {
    const value = String(track ?? 'internal').trim().toLowerCase();
    return value.length > 0 ? value : 'internal';
  }

  private async hashFileSha256(filePath: string) {
    const exists = await fs.promises
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new BadRequestException(
        this.i18n.t('publication.artifact_file_missing', { path: filePath }),
      );
    }

    return new Promise<string>((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private async getBuildWithArtifact(buildId: number) {
    const build = await this.buildRepository.findOne({ where: { id: buildId } });
    if (!build) {
      throw new NotFoundException(this.i18n.t('publication.build_not_found'));
    }

    if (!build.artifactPath) {
      throw new BadRequestException(this.i18n.t('publication.artifact_missing'));
    }

    if (build.status !== BuildStatus.SUCCESS) {
      throw new BadRequestException(this.i18n.t('publication.build_not_success'));
    }

    return build;
  }

  private async findSuccessfulPublication(args: {
    repositoryId: number;
    platform: PublicationPlatform;
    track: string;
    commitSha: string;
    artifactHash: string;
  }) {
    return this.publicationRepository.findOne({
      where: {
        repositoryId: args.repositoryId,
        platform: args.platform,
        track: args.track,
        commitSha: args.commitSha,
        artifactHash: args.artifactHash,
        status: PublicationStatus.SUCCESS,
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async reserveVersionCode(args: {
    repositoryId: number;
    platform: PublicationPlatform;
    track: string;
  }) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(VersionCodeStateEntity);
      const qb = repo
        .createQueryBuilder('state')
        .setLock('pessimistic_write')
        .where('state.repository_id = :repositoryId', {
          repositoryId: args.repositoryId,
        })
        .andWhere('state.platform = :platform', { platform: args.platform })
        .andWhere('state.track = :track', { track: args.track });

      let state = await qb.getOne();
      if (!state) {
        state = repo.create({
          repositoryId: args.repositoryId,
          platform: args.platform,
          track: args.track,
          nextVersionCode: 2,
          lastReservedAt: new Date(),
        });
        await repo.save(state);
        return 1;
      }

      const reserved = state.nextVersionCode;
      state.nextVersionCode = reserved + 1;
      state.lastReservedAt = new Date();
      await repo.save(state);
      return reserved;
    });
  }

  async plan(dto: PlanPublicationDto) {
    const build = await this.getBuildWithArtifact(dto.buildId);
    const platform = dto.platform ?? PublicationPlatform.ANDROID;
    const track = this.normalizeTrack(dto.track);
    const artifactHash = await this.hashFileSha256(build.artifactPath!);

    const existing = await this.findSuccessfulPublication({
      repositoryId: build.repoId,
      platform,
      track,
      commitSha: build.commitSha,
      artifactHash,
    });

    if (existing) {
      return {
        ok: true,
        alreadyPublished: true,
        skipUpload: true,
        skipVersionCode: true,
        publicationId: existing.id,
        versionCode: existing.versionCode,
        message: this.i18n.t('publication.already_exists'),
      };
    }

    return {
      ok: true,
      alreadyPublished: false,
      skipUpload: false,
      skipVersionCode: false,
      repositoryId: build.repoId,
      platform,
      track,
      commitSha: build.commitSha,
      artifactHash,
      message: this.i18n.t('publication.ready_to_publish'),
    };
  }

  async create(dto: CreatePublicationDto) {
    const build = await this.getBuildWithArtifact(dto.buildId);
    const platform = dto.platform ?? PublicationPlatform.ANDROID;
    const track = this.normalizeTrack(dto.track);
    const provider = dto.provider ?? PublicationProvider.GOOGLE_PLAY;
    const artifactHash = await this.hashFileSha256(build.artifactPath!);

    const existing = await this.findSuccessfulPublication({
      repositoryId: build.repoId,
      platform,
      track,
      commitSha: build.commitSha,
      artifactHash,
    });

    if (existing) {
      return {
        ok: true,
        alreadyPublished: true,
        skipUpload: true,
        skipVersionCode: true,
        publicationId: existing.id,
        versionCode: existing.versionCode,
        message: this.i18n.t('publication.already_exists'),
      };
    }

    // Reserve versionCode only when publication is actually being created.
    const versionCode = await this.reserveVersionCode({
      repositoryId: build.repoId,
      platform,
      track,
    });

    const publication = await this.publicationRepository.save(
      this.publicationRepository.create({
        buildId: build.id,
        repositoryId: build.repoId,
        platform,
        track,
        commitSha: build.commitSha,
        artifactHash,
        versionCode,
        provider,
        externalReleaseId: null,
        status: PublicationStatus.PENDING,
      }),
    );

    return {
      ok: true,
      alreadyPublished: false,
      skipUpload: false,
      skipVersionCode: false,
      publicationId: publication.id,
      versionCode,
      message: this.i18n.t('publication.created_pending'),
    };
  }

  async updateStatus(id: number, dto: UpdatePublicationStatusDto) {
    const publication = await this.publicationRepository.findOne({
      where: { id },
    });
    if (!publication) {
      throw new NotFoundException(this.i18n.t('publication.not_found'));
    }

    publication.status = dto.status;
    if (dto.externalReleaseId) {
      publication.externalReleaseId = dto.externalReleaseId;
    }

    return this.publicationRepository.save(publication);
  }

  async list(args: ListPublicationsDto) {
    const qb = this.publicationRepository
      .createQueryBuilder('p')
      .orderBy('p.createdAt', 'DESC')
      .limit(100);

    if (args.buildId) qb.andWhere('p.buildId = :buildId', { buildId: args.buildId });
    if (args.repositoryId) {
      qb.andWhere('p.repositoryId = :repositoryId', {
        repositoryId: args.repositoryId,
      });
    }
    if (args.platform) qb.andWhere('p.platform = :platform', { platform: args.platform });
    if (args.status) qb.andWhere('p.status = :status', { status: args.status });

    return qb.getMany();
  }
}
