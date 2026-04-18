import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import { createHash } from 'crypto';
import {
  BuildEntity,
  BuildStatus,
  BuildTrigger,
} from '../../../shared/src/db/entities/build.entity';
import { RepoEntity } from '../../../shared/src/db/entities/repo.entity';
import {
  PublicationDistributionType,
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
import { ExecutePublicationDto } from './dto/execute-publication.dto';
import { I18nService } from '../../../shared/src/i18n/i18n.service';
import { GooglePlayPublisherService } from './google-play-publisher.service';
import { GitHubRepoService } from '../repos/github-repo.service';
import { TaskNotificationService } from './task-notification.service';

@Injectable()
export class PublicationsService {
  private readonly logger = new Logger(PublicationsService.name);

  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    @InjectRepository(PublicationEntity)
    private readonly publicationRepository: Repository<PublicationEntity>,
    @InjectRepository(VersionCodeStateEntity)
    private readonly versionCodeStateRepository: Repository<VersionCodeStateEntity>,
    private readonly dataSource: DataSource,
    private readonly i18n: I18nService,
    private readonly googlePlayPublisher: GooglePlayPublisherService,
    private readonly githubRepoService: GitHubRepoService,
    private readonly taskNotification: TaskNotificationService,
  ) {}

  private getGooglePlayServiceAccountPath() {
    return String(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? '').trim();
  }

  private normalizeTrack(track?: string) {
    const value = String(track ?? 'internal').trim().toLowerCase();
    return value.length > 0 ? value : 'internal';
  }

  private isMainOrMasterRef(ref?: string | null) {
    const value = String(ref ?? '')
      .trim()
      .toLowerCase()
      .replace('refs/heads/', '');

    return value === 'main' || value === 'master';
  }

  private isPrBuild(build: BuildEntity) {
    return (
      build.trigger === BuildTrigger.PR ||
      (build.prNumber != null && !this.isMainOrMasterRef(build.ref))
    );
  }

  private resolveDistributionForBuild(args: {
    build: BuildEntity;
    requestedTrack?: string;
  }) {
    if (this.isPrBuild(args.build)) {
      return {
        distributionType: PublicationDistributionType.INTERNAL_APP_SHARING,
        track: null,
      };
    }

    return {
      distributionType: PublicationDistributionType.TRACK,
      track: this.normalizeTrack(args.requestedTrack),
    };
  }

  private buildPrCommentMessage(args: {
    build: BuildEntity;
    downloadUrl: string;
    expiresAt?: Date | null;
  }) {
    const commitShort = String(args.build.commitSha ?? '').slice(0, 7);
    const expiresText = args.expiresAt
      ? args.expiresAt.toISOString().slice(0, 10)
      : '60 dias';

    return [
      'Build disponivel para testes:',
      '',
      `Branch: ${args.build.ref}`,
      `Commit: ${commitShort}`,
      `Download: ${args.downloadUrl}`,
      '',
      `Observacao: link valido ate ${expiresText}`,
    ].join('\n');
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
    distributionType: PublicationDistributionType;
    track: string | null;
    commitSha: string;
    artifactHash: string;
  }) {
    const qb = this.publicationRepository
      .createQueryBuilder('p')
      .where('p.repository_id = :repositoryId', {
        repositoryId: args.repositoryId,
      })
      .andWhere('p.platform = :platform', { platform: args.platform })
      .andWhere('p.distribution_type = :distributionType', {
        distributionType: args.distributionType,
      })
      .andWhere('p.commit_sha = :commitSha', { commitSha: args.commitSha })
      .andWhere('p.artifact_hash = :artifactHash', {
        artifactHash: args.artifactHash,
      })
      .andWhere('p.status = :status', { status: PublicationStatus.SUCCESS })
      .orderBy('p.createdAt', 'DESC')
      .limit(1);

    if (args.track == null) {
      qb.andWhere('p.track IS NULL');
    } else {
      qb.andWhere('p.track = :track', { track: args.track });
    }

    return qb.getOne();
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
    const distribution = this.resolveDistributionForBuild({
      build,
      requestedTrack: dto.track,
    });
    const artifactHash = await this.hashFileSha256(build.artifactPath!);

    const existing = await this.findSuccessfulPublication({
      repositoryId: build.repoId,
      platform,
      distributionType: distribution.distributionType,
      track: distribution.track,
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
      skipVersionCode:
        distribution.distributionType ===
        PublicationDistributionType.INTERNAL_APP_SHARING,
      repositoryId: build.repoId,
      platform,
      distributionType: distribution.distributionType,
      track: distribution.track,
      commitSha: build.commitSha,
      artifactHash,
      message: this.i18n.t('publication.ready_to_publish'),
    };
  }

  async create(dto: CreatePublicationDto) {
    const build = await this.getBuildWithArtifact(dto.buildId);
    const platform = dto.platform ?? PublicationPlatform.ANDROID;
    const distribution = this.resolveDistributionForBuild({
      build,
      requestedTrack: dto.track,
    });
    const provider = dto.provider ?? PublicationProvider.GOOGLE_PLAY;
    const artifactHash = await this.hashFileSha256(build.artifactPath!);

    const existing = await this.findSuccessfulPublication({
      repositoryId: build.repoId,
      platform,
      distributionType: distribution.distributionType,
      track: distribution.track,
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

    const shouldReserveVersionCode =
      distribution.distributionType === PublicationDistributionType.TRACK;
    const versionCode = shouldReserveVersionCode
      ? await this.reserveVersionCode({
          repositoryId: build.repoId,
          platform,
          track: distribution.track ?? 'internal',
        })
      : null;

    const publication = await this.publicationRepository.save(
      this.publicationRepository.create({
        buildId: build.id,
        repositoryId: build.repoId,
        platform,
        distributionType: distribution.distributionType,
        track: distribution.track,
        commitSha: build.commitSha,
        artifactHash,
        versionCode,
        provider,
        externalReleaseId: null,
        downloadUrl: null,
        certificateFingerprint: null,
        expiresAt: null,
        status: PublicationStatus.PENDING,
      }),
    );

    return {
      ok: true,
      alreadyPublished: false,
      skipUpload: false,
      skipVersionCode: !shouldReserveVersionCode,
      publicationId: publication.id,
      versionCode,
      distributionType: publication.distributionType,
      track: publication.track,
      message: shouldReserveVersionCode
        ? this.i18n.t('publication.created_pending')
        : this.i18n.t('publication.created_pending_internal_sharing'),
    };
  }

  async execute(id: number, dto: ExecutePublicationDto) {
    const publication = await this.publicationRepository.findOne({
      where: { id },
    });
    if (!publication) {
      throw new NotFoundException(this.i18n.t('publication.not_found'));
    }

    if (publication.status === PublicationStatus.SUCCESS) {
      return {
        ok: true,
        alreadyPublished: true,
        publicationId: publication.id,
        versionCode: publication.versionCode,
        message: this.i18n.t('publication.already_success'),
      };
    }

    const build = await this.getBuildWithArtifact(publication.buildId);

    this.logger.log(
      this.i18n.t('publication.execute_start', {
        publicationId: publication.id,
        distributionType: publication.distributionType,
        artifactPath: build.artifactPath ?? 'n/a',
        artifactHash: publication.artifactHash,
      }),
    );

    const existing = await this.findSuccessfulPublication({
      repositoryId: publication.repositoryId,
      platform: publication.platform,
      distributionType: publication.distributionType,
      track: publication.track,
      commitSha: publication.commitSha,
      artifactHash: publication.artifactHash,
    });

    if (existing && existing.id !== publication.id) {
      publication.status = PublicationStatus.SKIPPED;
      await this.publicationRepository.save(publication);
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

    const repo = await this.repoRepository.findOne({
      where: { id: publication.repositoryId },
    });
    if (!repo) {
      throw new NotFoundException(this.i18n.t('publication.repo_not_found'));
    }

    try {
      if (publication.provider === PublicationProvider.GOOGLE_PLAY) {
        if (publication.platform !== PublicationPlatform.ANDROID) {
          throw new BadRequestException(
            this.i18n.t('publication.google_play_android_only'),
          );
        }

        const packageName = String(repo.androidAppId ?? '').trim();
        if (!packageName) {
          throw new BadRequestException(
            this.i18n.t('publication.android_app_id_missing'),
          );
        }

        const serviceAccountJsonPath = this.getGooglePlayServiceAccountPath();
        if (!serviceAccountJsonPath) {
          throw new BadRequestException(
            this.i18n.t('publication.google_play_service_account_missing'),
          );
        }

        if (
          publication.distributionType ===
          PublicationDistributionType.INTERNAL_APP_SHARING
        ) {
          const internalSharingResult =
            await this.googlePlayPublisher.uploadInternalSharingArtifact(
              {
                serviceAccountJsonPath,
                packageName,
                artifactPath: build.artifactPath!,
              },
              { dryRun: dto.dryRun },
            );

          const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
          publication.externalReleaseId =
            internalSharingResult.externalReleaseId ?? publication.externalReleaseId;
          publication.downloadUrl = internalSharingResult.downloadUrl;
          publication.certificateFingerprint =
            internalSharingResult.certificateFingerprint;
          publication.expiresAt = expiresAt;
          publication.versionCode = null;
          publication.status = PublicationStatus.SUCCESS;
          await this.publicationRepository.save(publication);

          this.logger.log(
            this.i18n.t('publication.execute_result', {
              publicationId: publication.id,
              distributionType: publication.distributionType,
              artifactPath: build.artifactPath ?? 'n/a',
              artifactHash: publication.artifactHash,
              downloadUrl: publication.downloadUrl ?? 'n/a',
            }),
          );

          const prCommentMessage = publication.downloadUrl
            ? this.buildPrCommentMessage({
                build,
                downloadUrl: publication.downloadUrl,
                expiresAt: publication.expiresAt,
              })
            : null;

          let prCommentPosted = false;
          let prCommentError: string | null = null;
          let taskNotificationSent = false;
          let taskNotificationError: string | null = null;

          if (prCommentMessage && build.prNumber != null && !internalSharingResult.dryRun) {
            try {
              await this.githubRepoService.postPrComment(
                repo.owner,
                repo.name,
                build.prNumber,
                prCommentMessage,
              );
              this.logger.log(
                this.i18n.t('publication.pr_comment_posted', {
                  publicationId: publication.id,
                  prNumber: build.prNumber,
                }),
              );
              prCommentPosted = true;
            } catch (commentErr: any) {
              prCommentError = commentErr?.message ?? String(commentErr);
              this.logger.warn(
                this.i18n.t('publication.pr_comment_failed', {
                  publicationId: publication.id,
                  prNumber: build.prNumber,
                  error: prCommentError,
                }),
              );
            }

            try {
              if (publication.downloadUrl && publication.expiresAt) {
                const notificationResult = await this.taskNotification.notifyBuildAvailable({
                  owner: repo.owner,
                  name: repo.name,
                  branch: build.ref,
                  prNumber: build.prNumber,
                  downloadUrl: publication.downloadUrl,
                  expiresAt: publication.expiresAt,
                });
                taskNotificationSent = notificationResult.sent;
                taskNotificationError = notificationResult.error;
              }
            } catch (notifyErr: any) {
              taskNotificationError = notifyErr?.message ?? String(notifyErr);
              this.logger.warn(
                `Task notification error: ${taskNotificationError}`,
              );
            }
          }

          return {
            ok: true,
            publicationId: publication.id,
            status: publication.status,
            distributionType: publication.distributionType,
            versionCode: publication.versionCode,
            externalReleaseId: publication.externalReleaseId,
            downloadUrl: publication.downloadUrl,
            certificateFingerprint: publication.certificateFingerprint,
            expiresAt: publication.expiresAt,
            prCommentMessage,
            prCommentPosted,
            prCommentError,
            taskNotificationSent,
            taskNotificationError,
            dryRun: internalSharingResult.dryRun,
          };
        }

        const result = await this.googlePlayPublisher.publishBundle(
          {
            serviceAccountJsonPath,
            packageName,
            artifactPath: build.artifactPath!,
            track: publication.track ?? 'internal',
            versionCode: publication.versionCode,
          },
          { dryRun: dto.dryRun },
        );

        publication.externalReleaseId = result.externalReleaseId;
        publication.versionCode =
          result.uploadedVersionCode ?? publication.versionCode;
        publication.status = PublicationStatus.SUCCESS;
        publication.downloadUrl = null;
        publication.certificateFingerprint = null;
        publication.expiresAt = null;
        await this.publicationRepository.save(publication);

        this.logger.log(
          this.i18n.t('publication.execute_result', {
            publicationId: publication.id,
            distributionType: publication.distributionType,
            artifactPath: build.artifactPath ?? 'n/a',
            artifactHash: publication.artifactHash,
            downloadUrl: publication.downloadUrl ?? 'n/a',
          }),
        );

        return {
          ok: true,
          publicationId: publication.id,
          status: publication.status,
          distributionType: publication.distributionType,
          versionCode: publication.versionCode,
          externalReleaseId: publication.externalReleaseId,
          downloadUrl: publication.downloadUrl,
          dryRun: result.dryRun,
        };
      }

      throw new BadRequestException(
        this.i18n.t('publication.provider_not_supported', {
          provider: publication.provider,
        }),
      );
    } catch (err: any) {
      publication.status = PublicationStatus.FAILED;
      await this.publicationRepository.save(publication);

      if (err instanceof HttpException) {
        throw err;
      }

      const message = err?.message ?? String(err);
      this.logger.error(
        this.i18n.t('publication.execute_error', {
          publicationId: publication.id,
          message,
        }),
      );
      throw new BadRequestException(message);
    }
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
