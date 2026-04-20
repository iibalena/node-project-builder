import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RepoEntity } from '../../../shared/src/db/entities/repo.entity';
import {
  BuildEntity,
  BuildStatus,
  BuildTrigger,
} from '../../../shared/src/db/entities/build.entity';
import { BuildRefStateEntity } from '../../../shared/src/db/entities/build-ref-state.entity';
import { RepoType } from '../../../shared/src/db/entities/repo-type.enum';
import { I18nService } from '../../../shared/src/i18n/i18n.service';

type GithubHeaders = {
  'x-hub-signature-256'?: string;
  'x-github-event'?: string;
  'x-github-delivery'?: string;
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  constructor(
    @InjectRepository(RepoEntity)
    private readonly repoRepository: Repository<RepoEntity>,
    @InjectRepository(BuildEntity)
    private readonly buildRepository: Repository<BuildEntity>,
    @InjectRepository(BuildRefStateEntity)
    private readonly refStateRepository: Repository<BuildRefStateEntity>,
    private readonly i18n: I18nService,
  ) {}

  private getCooldownMs() {
    const value = Number(process.env.BUILD_COOLDOWN_MS ?? 60000);
    return Number.isFinite(value) ? value : 60000;
  }

  private isPrOnlyBuildsModeForRepo(repo: RepoEntity) {
    const prOnlyEnabled =
      String(process.env.PR_ONLY_BUILDS ?? 'false').toLowerCase() === 'true';
    return prOnlyEnabled && repo.type === RepoType.FLUTTER;
  }

  private buildRefKey(ref: string, prNumber: number | null) {
    return prNumber ? `pr:${prNumber}` : `branch:${ref}`;
  }

  private async getRefState(repoId: number, refKey: string) {
    return this.refStateRepository.findOne({ where: { repoId, refKey } });
  }

  private async upsertRefState(args: {
    repoId: number;
    refKey: string;
    ref: string;
    prNumber: number | null;
    sha: string;
    enqueuedAt: Date;
  }) {
    const existing = await this.getRefState(args.repoId, args.refKey);
    if (existing) {
      existing.lastSha = args.sha;
      existing.ref = args.ref;
      existing.prNumber = args.prNumber;
      existing.lastEnqueuedAt = args.enqueuedAt;
      return this.refStateRepository.save(existing);
    }

    return this.refStateRepository.save(
      this.refStateRepository.create({
        repoId: args.repoId,
        refKey: args.refKey,
        ref: args.ref,
        prNumber: args.prNumber,
        lastSha: args.sha,
        lastEnqueuedAt: args.enqueuedAt,
      }),
    );
  }

  private shouldCooldown(state?: BuildRefStateEntity | null) {
    if (!state?.lastEnqueuedAt) return false;
    const elapsed = Date.now() - state.lastEnqueuedAt.getTime();
    return elapsed < this.getCooldownMs();
  }

  isFromGitHubApp(payload: any): boolean {
    return payload?.installation?.id != null;
  }

  shouldProcessWebhook(payload: any): boolean {
    return this.isFromGitHubApp(payload);
  }

  private normalizeRepoKey(owner: string, name: string) {
    return `${owner}/${name}`.trim().toLowerCase();
  }

  private getIgnoredRepoKeys() {
    const raw = String(process.env.REPO_IGNORE_LIST ?? '').trim();
    if (!raw) {
      return new Set<string>();
    }

    return new Set(
      raw
        .split(/[;,]/g)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.includes('/')),
    );
  }

  isRepoFullNameIgnored(repoFullName: string): boolean {
    const value = String(repoFullName ?? '').trim().toLowerCase();
    if (!value || !value.includes('/')) {
      return false;
    }
    return this.getIgnoredRepoKeys().has(value);
  }

  isRepoIgnored(owner: string, name: string): boolean {
    return this.getIgnoredRepoKeys().has(this.normalizeRepoKey(owner, name));
  }

  private resolveRepository(payload: any): { owner: string | null; name: string | null } {
    const fullName = String(payload?.repository?.full_name ?? '').trim();
    if (fullName.includes('/')) {
      const [owner, name] = fullName.split('/', 2);
      if (owner && name) {
        return { owner, name };
      }
    }

    const owner =
      payload?.repository?.owner?.login ??
      payload?.repository?.owner?.name ??
      null;

    const name = payload?.repository?.name ?? null;
    return { owner, name };
  }

  verifyGithubSignature(rawBody: Buffer, headers: GithubHeaders): boolean {
    const secret =
      process.env.GITHUB_APP_WEBHOOK_SECRET ??
      process.env.GITHUB_WEBHOOK_SECRET ??
      '';
    if (!secret) return false;

    const sig = headers['x-hub-signature-256'];
    if (!sig?.startsWith('sha256=')) return false;

    const receivedHex = sig.slice('sha256='.length).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(receivedHex)) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(receivedHex, 'hex');
    const b = Buffer.from(expected, 'hex');

    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  private resolveWebhookTimestamp(payload: any, dateHeader?: string) {
    const candidates = [
      payload?.head_commit?.timestamp,
      payload?.pull_request?.updated_at,
      payload?.pull_request?.created_at,
      payload?.repository?.pushed_at
        ? new Date(Number(payload?.repository?.pushed_at) * 1000).toISOString()
        : null,
      dateHeader,
    ];

    for (const raw of candidates) {
      const value = String(raw ?? '').trim();
      if (!value) continue;
      const parsed = new Date(value).getTime();
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  isWebhookTooOld(payload: any, dateHeader?: string): boolean {
    if (!payload && !dateHeader) return false;

    const maxAgeMs = Number(process.env.MAX_WEBHOOK_AGE_MS ?? 300000);
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
      return false; // validation disabled if not configured properly
    }

    const webhookTime = this.resolveWebhookTimestamp(payload, dateHeader);
    if (!webhookTime) {
      return true;
    }

    const ageMs = Date.now() - webhookTime;
    return ageMs > maxAgeMs;
  }

  async handleGithubEvent(args: {
    rawBody: Buffer;
    headers: GithubHeaders;
    payload: any;
  }): Promise<{ ok: true; ignored?: boolean }> {
    const event = args.headers['x-github-event'] ?? '';

    const { owner: repoOwner, name: repoName } = this.resolveRepository(
      args.payload,
    );

    if (!repoOwner || !repoName) {
      this.logger.warn(this.i18n.t('webhook.payload_repo_missing'));
      return { ok: true, ignored: true };
    }

    if (this.isRepoIgnored(repoOwner, repoName)) {
      this.logger.log(
        `Webhook ignored by REPO_IGNORE_LIST for ${repoOwner}/${repoName}`,
      );
      return { ok: true, ignored: true };
    }

    const repo = await this.repoRepository.findOne({
      where: { owner: repoOwner, name: repoName, isActive: true },
    });

    if (!repo) {
      this.logger.debug(
        this.i18n.t('webhook.repo_not_tracked', {
          owner: repoOwner,
          name: repoName,
        }),
      );
      return { ok: true, ignored: true };
    }

    const installationId = String(args.payload?.installation?.id ?? '');
    if (installationId && !repo.githubInstallationId) {
      repo.githubInstallationId = installationId;
      await this.repoRepository.save(repo);
      this.logger.log(
        this.i18n.t('webhook.repo_installation_id_saved', {
          owner: repoOwner,
          name: repoName,
          installationId,
        }),
      );
    }

    // PR -> exe build
    if (event === 'pull_request') {
      const action = args.payload?.action;
      this.logger.log(this.i18n.t('webhook.pull_request_event', { action }));
      if (!['opened', 'reopened', 'synchronize'].includes(action)) {
        return { ok: true, ignored: true };
      }

      const sha = args.payload?.pull_request?.head?.sha;
      const ref = args.payload?.pull_request?.head?.ref;
      const prNumber = args.payload?.pull_request?.number;

      if (!sha || !ref || !prNumber) {
        this.logger.warn(this.i18n.t('webhook.pr_payload_missing'));
        return { ok: true, ignored: true };
      }

      const refKey = this.buildRefKey(ref, prNumber);
      const state = await this.getRefState(repo.id, refKey);
      if (state && state.lastSha === sha) {
        return { ok: true, ignored: true };
      }
      if (this.shouldCooldown(state)) {
        this.logger.log(
          this.i18n.t('webhook.cooldown_pr', {
            owner: repoOwner,
            name: repoName,
            pr: prNumber,
          }),
        );
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

      await this.upsertRefState({
        repoId: repo.id,
        refKey,
        ref,
        prNumber,
        sha,
        enqueuedAt: new Date(),
      });

      this.logger.log(
        this.i18n.t('webhook.pr_enqueued', {
          owner: repoOwner,
          name: repoName,
          pr: prNumber,
          sha,
        }),
      );

      return { ok: true };
    }

    // Merge / push -> build
    if (event === 'push') {
      this.logger.log(this.i18n.t('webhook.push_event'));

      if (this.isPrOnlyBuildsModeForRepo(repo)) {
        this.logger.log(this.i18n.t('webhook.push_ignored_pr_only'));
        return { ok: true, ignored: true };
      }

      const refFull = args.payload?.ref; // ex: refs/heads/main
      const sha = args.payload?.after;

      if (!refFull || !sha) return { ok: true, ignored: true };

      const ref = String(refFull).replace('refs/heads/', '');

      // Opcional: só enfileirar para a branch default do repo
      if (ref !== repo.defaultBranch) {
        this.logger.debug(
          this.i18n.t('webhook.push_ignored_branch', {
            ref,
            defaultBranch: repo.defaultBranch,
          }),
        );
        return { ok: true, ignored: true };
      }

      const refKey = this.buildRefKey(ref, null);
      const state = await this.getRefState(repo.id, refKey);
      if (state && state.lastSha === sha) {
        return { ok: true, ignored: true };
      }
      if (this.shouldCooldown(state)) {
        this.logger.log(
          this.i18n.t('webhook.cooldown_ref', {
            owner: repoOwner,
            name: repoName,
            ref,
          }),
        );
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

      await this.upsertRefState({
        repoId: repo.id,
        refKey,
        ref,
        prNumber: null,
        sha,
        enqueuedAt: new Date(),
      });

      this.logger.log(
        this.i18n.t('webhook.push_enqueued', {
          owner: repoOwner,
          name: repoName,
          ref,
          sha,
        }),
      );

      return { ok: true };
    }

    return { ok: true, ignored: true };
  }
}
