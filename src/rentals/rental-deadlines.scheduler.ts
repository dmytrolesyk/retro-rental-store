import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../config/env.schema';
import { ProcessRentalDeadlines } from './use-cases/process-rental-deadlines';

export const RENTAL_DEADLINES_JOB = 'rental-deadlines';

@Injectable()
export class RentalDeadlinesScheduler {
  private readonly logger = new Logger(RentalDeadlinesScheduler.name);

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly processRentalDeadlinesUseCase: ProcessRentalDeadlines,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: RENTAL_DEADLINES_JOB, waitForCompletion: true })
  async checkDeadlines(): Promise<void> {
    if (!this.configService.get('RENTAL_DEADLINES_ENABLED', { infer: true })) return;
    this.logger.log(await this.processRentalDeadlinesUseCase.execute());
  }
}
