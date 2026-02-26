import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { SyncService } from '../sync/sync.service';
import { GitHubRepoService } from './github-repo.service';
import { CreateRepoDto } from './dto/create-repo.dto';
import { UpdateRepoDto } from './dto/update-repo.dto';

@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name);
  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    private readonly syncService: SyncService,
    private readonly githubRepo: GitHubRepoService,
  ) {}

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
          `Branch padrao obtida para ${data.owner}/${data.name}: ${defaultBranch}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Falha ao obter branch padrao para ${data.owner}/${data.name}: ${err?.message ?? String(err)}. Usando 'master'`,
        );
        defaultBranch = 'master';
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
      this.logger.warn(
        `Falha no sync do repositorio ${saved.owner}/${saved.name}: ${syncResult.message ?? 'erro desconhecido'}`,
      );
    } else {
      this.logger.log(
        `Sync do repositorio disparado para ${saved.owner}/${saved.name}`,
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
      throw new Error(`Repositorio com id ${id} nao encontrado`);
    }

    if (typeof data.owner === 'string') {
      repo.owner = data.owner.trim();
    }

    if (typeof data.name === 'string') {
      repo.name = data.name.trim();
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
      `Repositorio ${saved.owner}/${saved.name} (id: ${saved.id}) atualizado`,
    );
    return saved;
  }

  async delete(id: number): Promise<void> {
    const repo = await this.repoRepository.findOne({ where: { id } });
    if (!repo) {
      throw new Error(`Repositorio com id ${id} nao encontrado`);
    }
    await this.repoRepository.remove(repo);
    this.logger.log(
      `Repositorio ${repo.owner}/${repo.name} (id: ${id}) removido`,
    );
  }
}
