import { Injectable, Logger } from '@nestjs/common';
import https from 'node:https';

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);

  private get token() {
    return process.env.GITHUB_TOKEN ?? '';
  }

  private requestJson<T>(path: string): Promise<T> {
    const token = this.token;
    if (!token) {
      throw new Error('GITHUB_TOKEN is not set');
    }

    const options = {
      hostname: 'api.github.com',
      method: 'GET',
      path,
      headers: {
        'User-Agent': 'node-project-builder',
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
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

          reject(new Error(`GitHub API ${res.statusCode}: ${body}`));
        });
      });

      req.on('error', reject);
      req.end();
    });
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

    this.logger.log(`Fetched ${pulls.length} open PRs for ${owner}/${repo}`);
    return pulls.map((p) => ({ number: p.number, sha: p.head?.sha ?? '', ref: p.head?.ref ?? '' }));
  }

  async getBranchSha(owner: string, repo: string, branch: string) {
    const data = await this.requestJson<{ sha?: string }>(`/repos/${owner}/${repo}/commits/${branch}`);
    return data?.sha ?? '';
  }
}
