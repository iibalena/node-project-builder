import { Injectable, Logger } from '@nestjs/common';
import https from 'node:https';
import dns from 'node:dns/promises';
import { I18nService } from '@shared/i18n/i18n.service';

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);

  constructor(private readonly i18n: I18nService) {}

  private get token() {
    return process.env.GITHUB_TOKEN ?? '';
  }

  private getRetryAttempts() {
    const value = Number(process.env.GITHUB_REQUEST_RETRIES ?? 5);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5;
  }

  private getRetryDelayMs() {
    const value = Number(process.env.GITHUB_RETRY_DELAY_MS ?? 5000);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5000;
  }

  private async wait(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async ensureGitHubReachable() {
    await dns.lookup('github.com');
  }

  private isRetryableNetworkError(error: unknown): boolean {
    const value = error as {
      code?: string;
      cause?: { code?: string };
      message?: string;
    };
    const code = value?.code ?? value?.cause?.code;
    const message = String(value?.message ?? '');

    const retryableCodes = new Set([
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
    ]);

    if (code && retryableCodes.has(code)) return true;

    return /getaddrinfo|ENOTFOUND|network|timeout|socket hang up/i.test(message);
  }

  private requestJsonOnce<T>(path: string, token: string): Promise<T> {
    const options = {
      hostname: 'api.github.com',
      method: 'GET',
      path,
      headers: {
        'User-Agent': 'node-project-builder',
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    return new Promise<T>((resolve, reject) => {
      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body) as T);
            } catch (err) {
              reject(err);
            }
            return;
          }

          reject(
            new Error(
              this.i18n.t('github.api_error', {
                status: res.statusCode,
                body,
              }),
            ),
          );
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  private requestJson<T>(path: string): Promise<T> {
    const token = this.token;
    if (!token) {
      throw new Error(this.i18n.t('github.token_missing'));
    }

    const maxAttempts = this.getRetryAttempts();
    const retryDelayMs = this.getRetryDelayMs();

    const run = async () => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await this.ensureGitHubReachable();
          return await this.requestJsonOnce<T>(path, token);
        } catch (error) {
          lastError = error;
          if (attempt >= maxAttempts || !this.isRetryableNetworkError(error)) {
            throw error;
          }

          this.logger.warn(
            this.i18n.t('github.request_retry', {
              attempt,
              max: maxAttempts,
              delay: Math.round(retryDelayMs / 1000),
              error: (error as any)?.message ?? String(error),
            }),
          );
          await this.wait(retryDelayMs);
        }
      }

      throw lastError;
    };

    return run();
  }

  async listOpenPulls(owner: string, repo: string) {
    const pulls: { number: number; head: { sha: string; ref: string } }[] = [];
    let page = 1;

    while (true) {
      const path = `/repos/${owner}/${repo}/pulls?state=open&per_page=100&page=${page}`;
      const pageData = await this.requestJson<typeof pulls>(path);
      if (!Array.isArray(pageData) || pageData.length === 0) break;
      pulls.push(...pageData);
      if (pageData.length < 100) break;
      page += 1;
    }

    this.logger.log(
      this.i18n.t('github.open_prs_fetched', {
        count: pulls.length,
        owner,
        repo,
      }),
    );
    return pulls.map((p) => ({
      number: p.number,
      sha: p.head?.sha ?? '',
      ref: p.head?.ref ?? '',
    }));
  }

  async getBranchSha(owner: string, repo: string, branch: string) {
    const data = await this.requestJson<{ sha?: string }>(
      `/repos/${owner}/${repo}/commits/${branch}`,
    );
    return data?.sha ?? '';
  }
}
