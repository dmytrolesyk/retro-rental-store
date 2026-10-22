import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { RentalJob } from './entities/rental-job.entity';
import { EmailService } from '../email/email.service';
import { JobsService } from './jobs.service';

@Injectable()
export class RentalConfirmationWorker {
  constructor(
    private readonly jobs: JobsService,
    private readonly email: EmailService,
  ) {}

  run(jobIds: string[]): Promise<void> {
    return this.jobs.runWorker('email-worker', job => this.process(job), jobIds);
  }

  async process(job: RentalJob): Promise<void> {
    // Build rental-specific content from immutable task data so retries match.
    await this.email.send({
      to: job.emailTo,
      subject: 'Підтвердження оренди — Retro Games Rental',
      text: `Вашу оренду №${job.rentalId} успішно оформлено. Дякуємо!`,
      idempotencyKey: `rental-confirmation/${job.jobId}`,
    });
    // Space API requests within this worker, as before the entry-point refactor.
    await delay(600);
    console.log(`Accepted rental confirmation for job ${job.jobId}`);
  }
}
