import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from '../../../shared/src/i18n/i18n.service';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly i18n: I18nService) {}

  private getRunnerUrl() {
    return (process.env.RUNNER_URL ?? '').trim();
  }

  async syncNow(body: {
    repoId?: number;
    repo?: string;
    prNumber?: number;
    ref?: string;
    force?: boolean;
  }) {
    const baseUrl = this.getRunnerUrl();
    if (!baseUrl) {
      return { ok: false, message: this.i18n.t('sync.runner_url_missing') };
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
      const message = err?.message ?? String(err);
      this.logger.error(message);
      return { ok: false, message };
    }
  }

  async syncRepo(body: { repoId: number }) {
    const baseUrl = this.getRunnerUrl();
    if (!baseUrl) {
      return { ok: false, message: this.i18n.t('sync.runner_url_missing') };
    }

    const url = `${baseUrl.replace(/\/$/, '')}/sync/repo`;
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
      const message = err?.message ?? String(err);
      this.logger.error(message);
      return { ok: false, message };
    }
  }
}
