import { Controller, Post, Req, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('github')
  async github(@Req() req: RawBodyRequest) {
    const rawBody = req.rawBody ?? Buffer.from('');
    const payload = req.body;
    const delivery = String(req.headers['x-github-delivery'] ?? '');
    const event = String(req.headers['x-github-event'] ?? '');
    this.logger.log(`Incoming webhook delivery=${delivery} event=${event}`);

    await this.webhooksService.handleGithubEvent({
      rawBody,
      headers: {
        'x-hub-signature-256': String(req.headers['x-hub-signature-256'] ?? ''),
        'x-github-event': String(req.headers['x-github-event'] ?? ''),
        'x-github-delivery': String(req.headers['x-github-delivery'] ?? ''),
      },
      payload,
    });

    this.logger.log(`Webhook ${delivery} processed (returned 200)`);

    // sempre 200 pro GitHub não ficar retryando por motivo bobo
    return { ok: true };
  }
}
