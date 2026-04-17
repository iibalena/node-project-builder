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

  async notifyBuildAvailable(args: {
    owner: string;
    name: string;
    branch: string;
    prNumber: number;
    downloadUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    if (!this.isEnabled()) {
      return;
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

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'node-project-builder-task-notifier',
          ...(webhookKey && { 'X-Task-Notification-Key': webhookKey }),
        },
      };

      await new Promise<void>((resolve, reject) => {
        const req = client.request(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (d) => chunks.push(Buffer.from(d)));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
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

      this.logger.log(
        `Task notification sent successfully to ${webhookUrl} for PR #${args.prNumber}`,
      );
    } catch (error: any) {
      this.logger.warn(
        `Failed to notify webhook at ${webhookUrl}: ${error?.message ?? String(error)}`,
      );
    }
  }
}
