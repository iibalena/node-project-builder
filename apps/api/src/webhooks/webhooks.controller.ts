import { Controller, Post, Req, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { I18nService } from '@shared/i18n/i18n.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly i18n: I18nService,
  ) {}

  @Post('github')
  async github(@Req() req: RawBodyRequest) {
    const rawBody = req.rawBody ?? Buffer.from('');
    const payload = req.body;
    const delivery = String(req.headers['x-github-delivery'] ?? '');
    const event = String(req.headers['x-github-event'] ?? '');
    this.logger.log(
      this.i18n.t('webhook.received', {
        delivery,
        event,
      }),
    );

    await this.webhooksService.handleGithubEvent({
      rawBody,
      headers: {
        'x-hub-signature-256': String(req.headers['x-hub-signature-256'] ?? ''),
        'x-github-event': String(req.headers['x-github-event'] ?? ''),
        'x-github-delivery': String(req.headers['x-github-delivery'] ?? ''),
      },
      payload,
    });

    this.logger.log(
      this.i18n.t('webhook.processed', {
        delivery,
      }),
    );

    // sempre 200 pro GitHub não ficar retryando por motivo bobo
    return { ok: true };
  }
}
