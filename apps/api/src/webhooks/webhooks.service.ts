import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RepoEntity } from '@shared/db/entities/repo.entity';
import { BuildEntity, BuildStatus, BuildTrigger } from '@shared/db/entities/build.entity';

type GithubHeaders = {
  'x-hub-signature-256'?: string;
  'x-github-event'?: string;
  'x-github-delivery'?: string;
};

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
  ) {}

  verifyGithubSignature(rawBody: Buffer, headers: GithubHeaders): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
    if (!secret) return false;

    const sig = headers['x-hub-signature-256'];
    if (!sig?.startsWith('sha256=')) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(sig.replace('sha256=', ''), 'hex');
    const b = Buffer.from(expected, 'hex');

    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  async handleGithubEvent(args: {
    rawBody: Buffer;
    headers: GithubHeaders;
    payload: any;
  }): Promise<{ ok: true; ignored?: boolean }> {
    const ok = this.verifyGithubSignature(args.rawBody, args.headers);
    if (!ok) {
      return { ok: true, ignored: true };
    }

    const event = args.headers['x-github-event'] ?? '';

    const repoOwner =
      args.payload?.repository?.owner?.login ??
      args.payload?.repository?.owner?.name ??
      null;

    const repoName = args.payload?.repository?.name ?? null;

    if (!repoOwner || !repoName) {
      return { ok: true, ignored: true };
    }

    const repo = await this.repoRepository.findOne({
      where: { owner: repoOwner, name: repoName, isActive: true },
    });

    if (!repo) {
      return { ok: true, ignored: true };
    }

    // PR -> exe build
    if (event === 'pull_request') {
      const action = args.payload?.action;
      if (!['opened', 'reopened', 'synchronize'].includes(action)) {
        return { ok: true, ignored: true };
      }

      const sha = args.payload?.pull_request?.head?.sha;
      const ref = args.payload?.pull_request?.head?.ref;
      const prNumber = args.payload?.pull_request?.number;

      if (!sha || !ref || !prNumber) {
        return { ok: true, ignored: true };
      }

      await this.buildRepository.save(
        this.buildRepository.create({
          repoId: repo.id,
          trigger: BuildTrigger.PR,
          ref,
          commitSha: sha,
          prNumber,
          status: BuildStatus.QUEUED,
        }),
      );

      return { ok: true };
    }

    // Merge / push -> build
    if (event === 'push') {
      const refFull = args.payload?.ref; // ex: refs/heads/main
      const sha = args.payload?.after;

      if (!refFull || !sha) return { ok: true, ignored: true };

      const ref = String(refFull).replace('refs/heads/', '');

      // Opcional: só enfileirar para a branch default do repo
      if (ref !== repo.defaultBranch) {
        return { ok: true, ignored: true };
      }

      await this.buildRepository.save(
        this.buildRepository.create({
          repoId: repo.id,
          trigger: BuildTrigger.MERGE,
          ref,
          commitSha: sha,
          prNumber: null,
          status: BuildStatus.QUEUED,
        }),
      );

      return { ok: true };
    }

    return { ok: true, ignored: true };
  }
}
