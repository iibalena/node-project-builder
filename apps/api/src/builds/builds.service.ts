import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuildEntity } from '@shared/db/entities/build.entity';

@Injectable()
export class BuildsService {
  constructor(
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
  ) {}

  async list(args: { repoId?: number; status?: string }) {
    const qb = this.buildRepository
      .createQueryBuilder('b')
      .orderBy('b.createdAt', 'DESC')
      .limit(50);

    if (args.repoId) qb.andWhere('b.repoId = :repoId', { repoId: args.repoId });
    if (args.status) qb.andWhere('b.status = :status', { status: args.status });

    return qb.getMany();
  }
}
