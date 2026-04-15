import {
  Controller,
  Get,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { I18nService } from '../../../shared/src/i18n/i18n.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly i18n: I18nService,
  ) {}

  @Post('github/webhook')
  async githubWebhook(@Req() req: RawBodyRequest) {
    return this.handleGithubWebhook(req);
  }

  @Post('webhooks/github')
  async githubWebhookLegacy(@Req() req: RawBodyRequest) {
    return this.handleGithubWebhook(req);
  }

  @Get('github/webhook/health')
  githubWebhookHealth() {
    this.logger.log(this.i18n.t('webhook.health_check'));
    return {
      ok: true,
      endpoint: 'POST /github/webhook',
      secretConfigured: Boolean(
        process.env.GITHUB_WEBHOOK_SECRET ?? process.env.GITHUB_APP_WEBHOOK_SECRET,
      ),
      rawBodyEnabled: true,
    };
  }

  private async handleGithubWebhook(req: RawBodyRequest) {
    const rawBody = req.rawBody ?? Buffer.from('');
    const payload = req.body;
    const delivery = String(req.headers['x-github-delivery'] ?? '');
    const event = String(req.headers['x-github-event'] ?? '');
    const signature = String(req.headers['x-hub-signature-256'] ?? '');
    const source = this.webhooksService.isFromGitHubApp(payload)
      ? 'github-app'
      : 'repo-webhook';
    const repository = String(payload?.repository?.full_name ?? '');
    const ref = String(payload?.ref ?? payload?.pull_request?.head?.ref ?? '');

    this.logger.log(
      this.i18n.t('webhook.received_details', {
        delivery,
        event,
        source,
        repository: repository || 'n/a',
        ref: ref || 'n/a',
      }),
    );

    const isSignatureValid = this.webhooksService.verifyGithubSignature(rawBody, {
      'x-hub-signature-256': signature,
      'x-github-event': event,
      'x-github-delivery': delivery,
    });

    if (!isSignatureValid) {
      this.logger.warn(
        this.i18n.t('webhook.rejected_signature', {
          delivery,
          event,
          source,
          repository: repository || 'n/a',
          ref: ref || 'n/a',
        }),
      );
      throw new UnauthorizedException(this.i18n.t('webhook.signature_invalid'));
    }

    if (!this.webhooksService.shouldProcessWebhook(payload)) {
      this.logger.log(
        this.i18n.t('webhook.ignored_legacy', {
          delivery,
          event,
          source,
          repository: repository || 'n/a',
          ref: ref || 'n/a',
        }),
      );
      return { ok: true, ignored: true };
    }

    await this.webhooksService.handleGithubEvent({
      rawBody,
      headers: {
        'x-hub-signature-256': signature,
        'x-github-event': event,
        'x-github-delivery': delivery,
      },
      payload,
    });

    this.logger.log(
      this.i18n.t('webhook.accepted', {
        delivery,
        event,
        source,
        repository: repository || 'n/a',
        ref: ref || 'n/a',
      }),
    );

    return { ok: true };
  }
}
