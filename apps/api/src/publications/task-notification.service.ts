import { Injectable, Logger } from '@nestjs/common';
import https from 'node:https';
import http from 'node:http';

@Injectable()
export class TaskNotificationService {
  private readonly logger = new Logger(TaskNotificationService.name);

  private getWebhookUrl() {
    return String(process.env.TASK_NOTIFICATION_WEBHOOK_URL ?? '').trim();
  }

  private getWebhookKey() {
    return String(process.env.TASK_NOTIFICATION_WEBHOOK_KEY ?? '').trim();
  }

  private isEnabled() {
    return this.getWebhookUrl().length > 0;
  }

  private tryDecodeWebhookKey(rawKey: string) {
    if (!rawKey.includes('%')) {
      return rawKey;
    }

    try {
      return decodeURIComponent(rawKey);
    } catch {
      return rawKey;
    }
  }

  private getAuthHeaders(key: string) {
    if (!key) {
      return {};
    }

    return {
      'X-Task-Notification-Key': key,
      'x-api-key': key,
      Authorization: `Bearer ${key}`,
    };
  }

  async notifyBuildAvailable(args: {
    owner: string;
    name: string;
    branch: string;
    prNumber: number;
    downloadUrl: string;
    expiresAt: Date;
  }): Promise<{ sent: boolean; statusCode: number | null; error: string | null }> {
    if (!this.isEnabled()) {
      this.logger.log('Task notification skipped: TASK_NOTIFICATION_WEBHOOK_URL is not configured');
      return { sent: false, statusCode: null, error: 'TASK_NOTIFICATION_WEBHOOK_URL is not configured' };
    }

    const webhookUrl = this.getWebhookUrl();
    const webhookKey = this.getWebhookKey();

    const payload = JSON.stringify({
      owner: args.owner,
      name: args.name,
      branch: args.branch,
      prNumber: args.prNumber,
      downloadUrl: args.downloadUrl,
      expiresAt: args.expiresAt.toISOString(),
    });

    try {
      const url = new URL(webhookUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const startedAt = Date.now();
      const decodedWebhookKey = this.tryDecodeWebhookKey(webhookKey);
      const shouldRetryWithDecodedKey =
        decodedWebhookKey.length > 0 && decodedWebhookKey !== webhookKey;

      this.logger.log(
        `Task notification webhook call started url=${webhookUrl} owner=${args.owner} repo=${args.name} branch=${args.branch} pr=${args.prNumber}`,
      );

      const sendRequest = async (keyForHeaders: string) => {
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'User-Agent': 'node-project-builder-task-notifier',
            ...this.getAuthHeaders(keyForHeaders),
          },
        };

        return new Promise<number>((resolve, reject) => {
          const req = client.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d) => chunks.push(Buffer.from(d)));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(res.statusCode);
                return;
              }

              const body = Buffer.concat(chunks).toString('utf8');
              reject(
                new Error(
                  `Webhook returned ${res.statusCode}: ${body.slice(0, 200)}`,
                ),
              );
            });
          });

          req.on('error', reject);
          req.write(payload);
          req.end();
        });
      };

      let statusCode: number;
      try {
        statusCode = await sendRequest(webhookKey);
      } catch (firstErr: any) {
        const message = firstErr?.message ?? String(firstErr);
        const unauthorized = /Webhook returned 401:/i.test(message);
        if (!unauthorized || !shouldRetryWithDecodedKey) {
          throw firstErr;
        }

        this.logger.warn(
          'Task notification got 401 with raw key, retrying once with URL-decoded key',
        );
        statusCode = await sendRequest(decodedWebhookKey);
      }

      this.logger.log(
        `Task notification webhook call succeeded status=${statusCode} durationMs=${Date.now() - startedAt} url=${webhookUrl} pr=${args.prNumber}`,
      );
      return { sent: true, statusCode, error: null };
    } catch (error: any) {
      const message = error?.message ?? String(error);
      this.logger.warn(
        `Task notification webhook call failed url=${webhookUrl} pr=${args.prNumber} error=${message}`,
      );
      return { sent: false, statusCode: null, error: message };
    }
  }
}
