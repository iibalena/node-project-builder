import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

@Injectable()
export class AlertEmailService {
  private readonly logger = new Logger(AlertEmailService.name);
  private readonly sentAtByKey = new Map<string, number>();

  private getSmtpHost() {
    return String(process.env.SMTP_HOST ?? '').trim();
  }

  private getSmtpPort() {
    const value = Number(process.env.SMTP_PORT ?? 587);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 587;
  }

  private isSmtpSecure() {
    return String(process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true';
  }

  private getSmtpUser() {
    return String(process.env.SMTP_USER ?? '').trim();
  }

  private getSmtpPass() {
    return String(process.env.SMTP_PASS ?? '').trim();
  }

  private getFromAddress() {
    const from = String(process.env.SMTP_FROM ?? '').trim();
    if (from) {
      return from;
    }

    return this.getSmtpUser();
  }

  private escapePowerShellSingleQuoted(value: string) {
    return value.replace(/'/g, "''");
  }

  private getSmtpScript(args: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    to: string;
    subject: string;
    body: string;
  }) {
    const host = this.escapePowerShellSingleQuoted(args.host);
    const user = this.escapePowerShellSingleQuoted(args.user);
    const pass = this.escapePowerShellSingleQuoted(args.pass);
    const from = this.escapePowerShellSingleQuoted(args.from);
    const to = this.escapePowerShellSingleQuoted(args.to);
    const subject = this.escapePowerShellSingleQuoted(args.subject);
    const body = this.escapePowerShellSingleQuoted(args.body);

    return [
      "$ErrorActionPreference='Stop'",
      `$smtpHost='${host}'`,
      `$smtpPort=${args.port}`,
      `$smtpUseSsl=${args.secure ? '$true' : '$false'}`,
      `$smtpUser='${user}'`,
      `$smtpPass='${pass}'`,
      `$mailFrom='${from}'`,
      `$mailTo='${to}'`,
      `$mailSubject='${subject}'`,
      `$mailBody='${body}'`,
      '$params=@{',
      '  SmtpServer=$smtpHost',
      '  Port=$smtpPort',
      '  UseSsl=$smtpUseSsl',
      '  From=$mailFrom',
      '  To=$mailTo',
      '  Subject=$mailSubject',
      '  Body=$mailBody',
      '}',
      'if ($smtpUser -and $smtpPass) {',
      '  $securePass = ConvertTo-SecureString $smtpPass -AsPlainText -Force',
      '  $params.Credential = New-Object System.Management.Automation.PSCredential($smtpUser, $securePass)',
      '}',
      'Send-MailMessage @params',
    ].join('\n');
  }

  private summarizeSendError(error: any) {
    const stderr = String(error?.stderr ?? '').trim();
    if (stderr) {
      const firstLine = stderr.split(/\r?\n/)[0]?.trim();
      if (firstLine) {
        return firstLine;
      }
    }

    const message = String(error?.message ?? 'Unknown error').trim();
    const firstLine = message.split(/\r?\n/)[0]?.trim();
    return firstLine || 'Unknown error';
  }

  private getRecipients() {
    const raw = String(process.env.ALERT_EMAIL_TO ?? '').trim();
    if (!raw) {
      return [] as string[];
    }

    return raw
      .split(/[;,]/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private getCooldownMs() {
    const value = Number(process.env.ALERT_EMAIL_COOLDOWN_MS ?? 3600000);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 3600000;
  }

  private isEnabled() {
    return this.getSmtpHost().length > 0 && this.getRecipients().length > 0;
  }

  private shouldSkipByCooldown(key: string) {
    if (!key) {
      return false;
    }

    const now = Date.now();
    const lastSentAt = this.sentAtByKey.get(key);
    if (!lastSentAt) {
      this.sentAtByKey.set(key, now);
      return false;
    }

    const cooldownMs = this.getCooldownMs();
    if (now - lastSentAt < cooldownMs) {
      return true;
    }

    this.sentAtByKey.set(key, now);
    return false;
  }

  async sendAlert(args: {
    subject: string;
    text: string;
    key?: string;
  }): Promise<{ sent: boolean; reason?: string }> {
    if (!this.isEnabled()) {
      return {
        sent: false,
        reason: 'SMTP_HOST or ALERT_EMAIL_TO is not configured',
      };
    }

    const key = String(args.key ?? '').trim();
    if (this.shouldSkipByCooldown(key)) {
      return {
        sent: false,
        reason: 'cooldown',
      };
    }

    return await this.sendEmailUnconstrained(args.subject, args.text);
  }

  async sendBuildAlert(args: {
    buildId: number;
    repoOwner: string;
    repoName: string;
    branch: string;
    status: 'SUCCESS' | 'FAILED';
    log?: string;
    duration?: number;
  }): Promise<{ sent: boolean; reason?: string }> {
    const subject =
      args.status === 'SUCCESS'
        ? `[Build ${args.buildId}] ✅ ${args.repoOwner}/${args.repoName} - ${args.branch}`
        : `[Build ${args.buildId}] ❌ ${args.repoOwner}/${args.repoName} - ${args.branch}`;

    const duration = args.duration ? ` (${Math.round(args.duration / 1000)}s)` : '';
    const header =
      args.status === 'SUCCESS'
        ? `Build #${args.buildId} concluído com sucesso!${duration}`
        : `Build #${args.buildId} falhou.${duration}`;

    const body =
      args.status === 'SUCCESS'
        ? [
            header,
            '',
            'Dados do build:',
            `  Repositório: ${args.repoOwner}/${args.repoName}`,
            `  Branch: ${args.branch}`,
            `  Status: ✅ Sucesso`,
            '',
          ].join('\n')
        : [
            header,
            '',
            'Dados do build:',
            `  Repositório: ${args.repoOwner}/${args.repoName}`,
            `  Branch: ${args.branch}`,
            `  Status: ❌ Falha`,
            '',
            'Log de erros:',
            '---',
            args.log || '(sem log disponível)',
            '---',
            '',
          ].join('\n');

    return await this.sendEmailUnconstrained(subject, body);
  }

  async sendWebhookRejectionAlert(args: {
    repository: string;
    webhook: 'invalid-signature' | 'unsupported-event';
    details?: string;
  }): Promise<{ sent: boolean; reason?: string }> {
    const typeLabel = {
      'invalid-signature': 'Assinatura Inválida',
      'unsupported-event': 'Evento Não Suportado',
    }[args.webhook];

    const subject = `[Webhook Rejeitado] ${typeLabel} - ${args.repository}`;

    const body = [
      `Webhook rejeitado para ${args.repository}`,
      '',
      `Tipo: ${typeLabel}`,
      args.details ? `Detalhes: ${args.details}` : '',
      '',
    ]
      .filter((line) => line !== '')
      .join('\n');

    return await this.sendEmailUnconstrained(subject, body);
  }

  private async sendEmailUnconstrained(
    subject: string,
    body: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    if (!this.isEnabled()) {
      return {
        sent: false,
        reason: 'SMTP_HOST or ALERT_EMAIL_TO is not configured',
      };
    }

    const host = this.getSmtpHost();
    const port = this.getSmtpPort();
    const secure = this.isSmtpSecure();
    const user = this.getSmtpUser();
    const pass = this.getSmtpPass();
    const from = this.getFromAddress();
    const to = this.getRecipients().join(', ');

    if (!from) {
      return {
        sent: false,
        reason: 'SMTP_FROM or SMTP_USER is not configured',
      };
    }

    try {
      const script = this.getSmtpScript({
        host,
        port,
        secure,
        user,
        pass,
        from,
        to,
        subject,
        body,
      });

      await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });

      this.logger.log(`Alert e-mail sent to ${to} subject=${subject}`);
      return { sent: true };
    } catch (error: any) {
      const message = this.summarizeSendError(error);
      this.logger.warn(`Failed to send alert e-mail: ${message}`);
      return { sent: false, reason: message };
    }
  }
}
