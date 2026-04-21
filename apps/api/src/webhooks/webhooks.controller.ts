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
import { AlertEmailService } from '../../../shared/src/notifications/alert-email.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly i18n: I18nService,
    private readonly alertEmail: AlertEmailService,
  ) {}

  private shouldAlertUntrackedWebhook() {
    return (
      String(process.env.WEBHOOK_ALERT_UNTRACKED_REPO ?? 'false').toLowerCase() ===
      'true'
    );
  }

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
    const dateHeader = String(req.headers['date'] ?? '');
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

    if (repository && this.webhooksService.isRepoFullNameIgnored(repository)) {
      this.logger.log(
        `Webhook ignored by REPO_IGNORE_LIST for ${repository} delivery=${delivery}`,
      );
      return { ok: true, ignored: true };
    }

    const isTrackedRepository = repository
      ? await this.webhooksService.isTrackedActiveRepoByFullName(repository)
      : false;

    if (!isTrackedRepository) {
      if (repository && this.shouldAlertUntrackedWebhook()) {
        await this.alertEmail.sendAlert({
          key: `webhook-untracked:${repository}:${event || 'n-a'}`,
          subject: `[node-project-builder] Webhook de repo nao cadastrado: ${repository}`,
          text: [
            'Webhook recebido para repositorio nao cadastrado no builder.',
            '',
            `Repositorio: ${repository}`,
            `Evento: ${event || 'n/a'}`,
            `Delivery: ${delivery || 'n/a'}`,
            `Source: ${source}`,
            `Ref: ${ref || 'n/a'}`,
          ].join('\n'),
        });
      }

      this.logger.log(
        `Webhook ignored for untracked repository ${repository || 'n/a'} delivery=${delivery}`,
      );
      return { ok: true, ignored: true };
    }

    // Check webhook age first (before signature validation)
    if (this.webhooksService.isWebhookTooOld(payload, dateHeader)) {
      if (
        repository &&
        !this.webhooksService.isRepoFullNameIgnored(repository)
      ) {
        await this.alertEmail.sendWebhookRejectionAlert({
          repository,
          webhook: 'unsupported-event',
          details: `Webhook muito antigo (recebido: ${dateHeader || 'data desconhecida'}). Delivery: ${delivery}`,
        });
      }

      this.logger.warn(
        `Webhook rejeitado por ser muito antigo. Repository: ${repository}, Delivery: ${delivery}, Date: ${dateHeader}`,
      );
      throw new UnauthorizedException('[webhook] Webhook muito antigo, rejeitado.');
    }

    const isSignatureValid = this.webhooksService.verifyGithubSignature(rawBody, {
      'x-hub-signature-256': signature,
      'x-github-event': event,
      'x-github-delivery': delivery,
    });

    if (!isSignatureValid) {
      if (
        repository &&
        !this.webhooksService.isRepoFullNameIgnored(repository)
      ) {
        await this.alertEmail.sendWebhookRejectionAlert({
          repository,
          webhook: 'invalid-signature',
          details: `Delivery: ${delivery}, Event: ${event}, Source: ${source}, Ref: ${ref || 'n/a'}`,
        });
      }

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
