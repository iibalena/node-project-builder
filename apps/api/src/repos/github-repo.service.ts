import { Injectable, Logger } from '@nestjs/common';
import https from 'node:https';
import { I18nService } from '@shared/i18n/i18n.service';

@Injectable()
export class GitHubRepoService {
  private readonly logger = new Logger(GitHubRepoService.name);

  constructor(private readonly i18n: I18nService) {}

  private get token() {
    return process.env.GITHUB_TOKEN ?? '';
  }

  private requestJson<T>(path: string): Promise<T> {
    const token = this.token;
    if (!token) {
      throw new Error(this.i18n.t('github.token_missing'));
    }

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

  async getRepoInfo(
    owner: string,
    repo: string,
  ): Promise<{ default_branch: string }> {
    const data = await this.requestJson<{ default_branch?: string }>(
      `/repos/${owner}/${repo}`,
    );
    return { default_branch: data?.default_branch ?? 'master' };
  }
}
