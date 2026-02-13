import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';

@Injectable()
export class ReposService {
  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
  ) {}

  async create(data: {
    owner: string;
    name: string;
    cloneUrl: string;
    defaultBranch?: string;
    installCommand?: string | null;
    useLegacyPeerDeps?: boolean;
  }): Promise<RepoEntity> {
    const repo = this.repoRepository.create({
      owner: data.owner,
      name: data.name,
      cloneUrl: data.cloneUrl,
      defaultBranch: data.defaultBranch ?? 'main',
      isActive: true,
      installCommand: data.installCommand ?? null,
      useLegacyPeerDeps: data.useLegacyPeerDeps ?? false,
    });

    return this.repoRepository.save(repo);
  }

  async list(): Promise<RepoEntity[]> {
    return this.repoRepository.find({
      order: { createdAt: 'DESC' },
    });
  }
}
