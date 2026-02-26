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

  private async write(
    dbEntry: string,
    consoleEntry: string,
    level: 'log' | 'error' = 'log',
  ) {
    const current = await this.read();
    const next = current ? `${current}\n${dbEntry}` : dbEntry;
    await this.buildRepository.update(this.buildId, { log: next });
    if (!this.consoleLogger) return;
    if (level === 'error') {
      this.consoleLogger.error(consoleEntry);
    } else {
      this.consoleLogger.log(consoleEntry);
    }
  }

  private async read(): Promise<string> {
    const b = await this.buildRepository.findOne({
      where: { id: this.buildId },
    });
    return b?.log ?? '';
  }

  async log(message: string) {
    const now = new Date().toISOString();
    const dbEntry = `[${now}] [build:${this.buildId}] [${this.refLabel}] ${message}`;
    const consoleEntry = `build:${this.buildId} ${message}`;
    await this.write(dbEntry, consoleEntry, 'log');
  }

  async error(message: string) {
    const now = new Date().toISOString();
    const dbEntry = `[${now}] [build:${this.buildId}] [${this.refLabel}] ERROR: ${message}`;
    const consoleEntry = `build:${this.buildId} ERROR: ${message}`;
    await this.write(dbEntry, consoleEntry, 'error');
  }

  async toString(): Promise<string> {
    return await this.read();
  }
}
