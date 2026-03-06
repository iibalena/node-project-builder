import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { SyncService } from '../sync/sync.service';
import { GitHubRepoService } from './github-repo.service';
import { CreateRepoDto } from './dto/create-repo.dto';
import { UpdateRepoDto } from './dto/update-repo.dto';
import { I18nService } from '@shared/i18n/i18n.service';
import { RepoType } from '@shared/db/entities/repo-type.enum';

@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name);
  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    private readonly syncService: SyncService,
    private readonly githubRepo: GitHubRepoService,
    private readonly i18n: I18nService,
  ) {}

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { code?: string } | undefined;
    return driverError?.code === '23505';
  }

  async create(data: CreateRepoDto): Promise<RepoEntity> {
    const cloneUrl =
      data.cloneUrl?.trim() ||
      `https://github.com/${data.owner}/${data.name}.git`;

    let defaultBranch = data.defaultBranch?.trim();
    if (!defaultBranch) {
      try {
        const repoInfo = await this.githubRepo.getRepoInfo(
          data.owner,
          data.name,
        );
        defaultBranch = repoInfo.default_branch;
        this.logger.log(
          this.i18n.t('repos.default_branch_fetched', {
            owner: data.owner,
            name: data.name,
            branch: defaultBranch,
          }),
        );
      } catch (err: any) {
        this.logger.warn(
          this.i18n.t('repos.default_branch_fetch_failed', {
            owner: data.owner,
            name: data.name,
            error: err?.message ?? String(err),
          }),
        );
        defaultBranch = 'master';
      }
    }

    const repo = this.repoRepository.create({
      owner: data.owner,
      name: data.name,
      type: data.type ?? RepoType.TYPESCRIPT,
      cloneUrl,
      defaultBranch,
      isActive: true,
      installCommand: data.installCommand ?? null,
      useLegacyPeerDeps: data.useLegacyPeerDeps ?? false,
    });

    let saved: RepoEntity;
    try {
      saved = await this.repoRepository.save(repo);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          this.i18n.t('repos.already_exists', {
            owner: data.owner,
            name: data.name,
          }),
        );
      }
      throw error;
    }

    const syncResult = await this.syncService.syncRepo({ repoId: saved.id });
    if (!syncResult.ok) {
      this.logger.warn(
        this.i18n.t('repos.sync_failed', {
          owner: saved.owner,
          name: saved.name,
          message:
            syncResult.message ?? this.i18n.t('common.unknown_error'),
        }),
      );
    } else {
      this.logger.log(
        this.i18n.t('repos.sync_triggered', {
          owner: saved.owner,
          name: saved.name,
        }),
      );
    }

    return saved;
  }

  async list(): Promise<RepoEntity[]> {
    return this.repoRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async update(id: number, data: UpdateRepoDto): Promise<RepoEntity> {
    const repo = await this.repoRepository.findOne({ where: { id } });
    if (!repo) {
      throw new Error(this.i18n.t('repos.not_found_by_id', { id }));
    }

    if (typeof data.owner === 'string') {
      repo.owner = data.owner.trim();
    }

    if (typeof data.name === 'string') {
      repo.name = data.name.trim();
    }

    if (typeof data.type === 'string') {
      repo.type = data.type;
    }

    if (typeof data.cloneUrl === 'string') {
      repo.cloneUrl = data.cloneUrl.trim();
    }

    if (typeof data.defaultBranch === 'string') {
      repo.defaultBranch = data.defaultBranch.trim();
    }

    if (typeof data.isActive === 'boolean') {
      repo.isActive = data.isActive;
    }

    if (data.installCommand === null) {
      repo.installCommand = null;
    } else if (typeof data.installCommand === 'string') {
      const value = data.installCommand.trim();
      repo.installCommand = value.length > 0 ? value : null;
    }

    if (typeof data.useLegacyPeerDeps === 'boolean') {
      repo.useLegacyPeerDeps = data.useLegacyPeerDeps;
    }

    const saved = await this.repoRepository.save(repo);
    this.logger.log(
      this.i18n.t('repos.updated', {
        owner: saved.owner,
        name: saved.name,
        id: saved.id,
      }),
    );
    return saved;
  }

  async delete(id: number): Promise<void> {
    const repo = await this.repoRepository.findOne({ where: { id } });
    if (!repo) {
      throw new Error(this.i18n.t('repos.not_found_by_id', { id }));
    }
    await this.repoRepository.remove(repo);
    this.logger.log(
      this.i18n.t('repos.deleted', {
        owner: repo.owner,
        name: repo.name,
        id,
      }),
    );
  }
}
