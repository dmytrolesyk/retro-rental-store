import { Injectable, Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { RentalJob } from './entities/rental-job.entity';
import type { PreparedEmail } from '../email/email.service';
import { EmailService } from '../email/email.service';
import { JobsService } from './jobs.service';

@Injectable()
export class RentalNotificationWorker {
  private readonly logger = new Logger(RentalNotificationWorker.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly emailService: EmailService,
  ) {}

  async run(jobIds: string[]): Promise<void> {
    if (!jobIds.length) return;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const result = await this.tick(jobIds);
      if (result === 'idle') {
        const state = await this.jobsService.emailBatchState(jobIds);
        if (state === 'done') return;
        if (state !== 'waiting')
          throw new Error(`Email batch is ${state}; inspect rental_jobs before retrying`);
        await delay(25);
        continue;
      }
      if (result === 'failed')
        throw new Error('Email delivery failed; inspect rental_jobs retry state');
      await delay(600);
    }
  }

  async runForever(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.tick();
        await delay(result === 'done' ? 600 : 1000, undefined, { signal });
      } catch {
        // Abort can change while awaiting the provider or the polling delay.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (signal.aborted) break;
        // Do not log provider bodies, database parameters or addresses.
        this.logger.error('Email worker iteration failed; retrying');
        await delay(1000, undefined, { signal }).catch(() => undefined);
      }
    }
  }

  async tick(jobIds?: string[]): Promise<'done' | 'failed' | 'busy' | 'idle'> {
    const jobId = await this.jobsService.prepareNextEmail(job => this.prepare(job), jobIds);
    if (!jobId) return 'idle';
    const result = await this.jobsService.deliverEmail(jobId, job => this.process(job));
    if (result === 'failed') this.logger.warn(`Email job ${jobId} failed; delivery state retained`);
    return result;
  }

  private prepare(job: RentalJob): PreparedEmail {
    return this.emailService.prepare({
      to: job.emailTo,
      subject: job.notification?.subject ?? 'Підтвердження оренди — Retro Games Rental',
      text: job.notification?.text ?? `Вашу оренду №${job.rentalId} успішно оформлено. Дякуємо!`,
      idempotencyKey: `${job.notification ? 'rental-status' : 'rental-confirmation'}/${job.jobId}`,
    });
  }

  async process(job: RentalJob): Promise<void> {
    await this.emailService.send(job.deliveryPayload ?? this.prepare(job));
  }
}
