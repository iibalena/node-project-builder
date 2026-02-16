import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BuildEntity } from '@shared/db/entities/build.entity';

export class BuildLogger {
  private refLabel: string;

  constructor(
    private buildId: number,
    private buildRepository: Repository<BuildEntity>,
    prNumber: number | null,
    ref: string,
    private consoleLogger?: Logger,
  ) {
    this.refLabel = prNumber != null ? `PR#${prNumber}` : ref;
  }

  private async write(entry: string, level: 'log' | 'error' = 'log') {
    const current = await this.read();
    const next = current ? `${current}\n${entry}` : entry;
    await this.buildRepository.update(this.buildId, { log: next });
    if (!this.consoleLogger) return;
    if (level === 'error') {
      this.consoleLogger.error(entry);
    } else {
      this.consoleLogger.log(entry);
    }
  }

  private async read(): Promise<string> {
    const b = await this.buildRepository.findOne({ where: { id: this.buildId } });
    return b?.log ?? '';
  }

  async log(message: string) {
    const now = new Date().toISOString();
    const entry = `[${now}] [build:${this.buildId}] [${this.refLabel}] ${message}`;
    await this.write(entry, 'log');
  }

  async error(message: string) {
    const now = new Date().toISOString();
    const entry = `[${now}] [build:${this.buildId}] [${this.refLabel}] ERROR: ${message}`;
    await this.write(entry, 'error');
  }

  async toString(): Promise<string> {
    return await this.read();
  }
}
