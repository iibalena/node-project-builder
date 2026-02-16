import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { SyncService } from '../sync/sync.service';
import { GitHubRepoService } from './github-repo.service';

@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name);
  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    private readonly syncService: SyncService,
    private readonly githubRepo: GitHubRepoService,
  ) {}

  async create(data: {
    owner: string;
    name: string;
    cloneUrl?: string;
    defaultBranch?: string;
    installCommand?: string | null;
    useLegacyPeerDeps?: boolean;
  }): Promise<RepoEntity> {
    const cloneUrl = data.cloneUrl?.trim() || `https://github.com/${data.owner}/${data.name}.git`;
    
    let defaultBranch = data.defaultBranch?.trim();
    if (!defaultBranch) {
      try {
        const repoInfo = await this.githubRepo.getRepoInfo(data.owner, data.name);
        defaultBranch = repoInfo.default_branch;
        this.logger.log(`Fetched default branch for ${data.owner}/${data.name}: ${defaultBranch}`);
      } catch (err: any) {
        this.logger.warn(`Failed to fetch default branch for ${data.owner}/${data.name}: ${err?.message ?? String(err)}, using 'main'`);
        defaultBranch = 'main';
      }
    }

    const repo = this.repoRepository.create({
      owner: data.owner,
      name: data.name,
      cloneUrl,
      defaultBranch,
      isActive: true,
      installCommand: data.installCommand ?? null,
      useLegacyPeerDeps: data.useLegacyPeerDeps ?? false,
    });

    const saved = await this.repoRepository.save(repo);

    const syncResult = await this.syncService.syncRepo({ repoId: saved.id });
    if (!syncResult.ok) {
      this.logger.warn(`Repo sync failed for ${saved.owner}/${saved.name}: ${syncResult.message ?? 'unknown error'}`);
    } else {
      this.logger.log(`Repo sync triggered for ${saved.owner}/${saved.name}`);
    }

    return saved;
  }

  async list(): Promise<RepoEntity[]> {
    return this.repoRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async delete(id: number): Promise<void> {
    const repo = await this.repoRepository.findOne({ where: { id } });
    if (!repo) {
      throw new Error(`Repository with id ${id} not found`);
    }
    await this.repoRepository.remove(repo);
    this.logger.log(`Repository ${repo.owner}/${repo.name} (id: ${id}) deleted`);
  }
}
