import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  private getRunnerUrl() {
    return (process.env.RUNNER_URL ?? '').trim();
  }

  async syncNow(body: { repoId: number; prNumber?: number; ref?: string }) {
    const baseUrl = this.getRunnerUrl();
    if (!baseUrl) {
      return { ok: false, message: 'RUNNER_URL not set' };
    }

    const url = `${baseUrl.replace(/\/$/, '')}/sync/now`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      return { ok: res.ok, status: res.status, data };
    } catch (err: any) {
      this.logger.error(err?.message ?? String(err));
      return { ok: false, message: err?.message ?? String(err) };
    }
  }
}
