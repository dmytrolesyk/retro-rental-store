import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { DataSource, In } from 'typeorm';
import type { FindOptionsWhere } from 'typeorm';
import { RentalJob } from './entities/rental-job.entity';
import type { PreparedEmail } from '../email/email.service';
import { emailRetry, EMAIL_RETRY_WINDOW_MS } from './email-retry';

type JobHandler = (job: RentalJob) => Promise<unknown>;

@Injectable()
export class JobsService {
  constructor(private readonly dataSource: DataSource) {}

  async emailBatchState(jobIds: string[]): Promise<'done' | 'waiting' | 'deferred' | 'failed'> {
    const [state] = await this.dataSource.query<
      {
        failed: boolean | null;
        pending: boolean | null;
        ready: boolean | null;
      }[]
    >(
      `SELECT bool_or(status = 'failed') AS failed,
      bool_or(status = 'new') AS pending,
      bool_or(status = 'new' AND next_attempt_at <= clock_timestamp()) AS ready
      FROM rental_jobs WHERE job_id = ANY($1::uuid[])`,
      [jobIds],
    );
    if (state.failed) return 'failed';
    if (state.ready) return 'waiting';
    return state.pending ? 'deferred' : 'done';
  }

  /** Commit the full request before any provider call, including the configured sender. */
  prepareNextEmail(
    prepare: (job: RentalJob) => PreparedEmail,
    jobIds?: string[],
  ): Promise<string | null> {
    return this.dataSource.transaction('READ COMMITTED', async manager => {
      const query = manager
        .getRepository(RentalJob)
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'new' })
        .andWhere('job.nextAttemptAt <= clock_timestamp()')
        .orderBy('job.nextAttemptAt', 'ASC')
        .addOrderBy('job.createdAt', 'ASC')
        .addOrderBy('job.jobId', 'ASC')
        .take(1)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked');
      if (jobIds) query.andWhere('job.jobId IN (:...jobIds)', { jobIds });
      const job = await query.getOne();
      if (!job) return null;
      if (!job.deliveryPayload) {
        await manager.update(RentalJob, job.jobId, {
          deliveryPayload: prepare(job),
          firstAttemptAt: () => 'clock_timestamp()',
        });
      }
      return job.jobId;
    });
  }

  async deliverEmail(jobId: string, send: JobHandler): Promise<'done' | 'failed' | 'busy'> {
    return this.dataSource.transaction('READ COMMITTED', async manager => {
      const job = await manager
        .getRepository(RentalJob)
        .createQueryBuilder('job')
        .where('job.jobId = :jobId AND job.status = :status', { jobId, status: 'new' })
        .andWhere('job.nextAttemptAt <= clock_timestamp()')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();
      if (!job) return 'busy';
      if (!job.deliveryPayload || !job.firstAttemptAt) throw new Error('Email was not prepared');
      const [clock] = await manager.query<{ now: Date }[]>('SELECT clock_timestamp() AS now');
      if (clock.now.getTime() >= job.firstAttemptAt.getTime() + EMAIL_RETRY_WINDOW_MS) {
        await manager.update(RentalJob, jobId, {
          status: 'failed',
          lastError: 'retry_window_expired',
        });
        return 'failed';
      }
      try {
        // Row lock prevents two workers from delivering the same job concurrently.
        await send(job);
      } catch (error) {
        const [failedClock] = await manager.query<{ now: Date }[]>(
          'SELECT clock_timestamp() AS now',
        );
        await manager.update(RentalJob, jobId, {
          ...emailRetry(error, job.attempts + 1, job.firstAttemptAt, failedClock.now),
          attempts: job.attempts + 1,
        });
        return 'failed';
      }
      await manager.update(RentalJob, jobId, {
        status: 'done',
        processed: () => 'processed + 1',
        attempts: job.attempts + 1,
        worker: 'email-worker',
        lastError: null,
      });
      return 'done';
    });
  }

  async runWorker(worker: string, handle: JobHandler, jobIds?: string[]): Promise<void> {
    const where = jobIds
      ? { status: 'new' as const, jobId: In(jobIds) }
      : { status: 'new' as const };
    // This loop ends only once the queue has no remaining new tasks.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const processed = await this.dataSource.transaction('READ COMMITTED', async manager => {
        const job = await manager
          .getRepository(RentalJob)
          .createQueryBuilder('job')
          .where(where)
          .orderBy('job.createdAt', 'ASC')
          .addOrderBy('job.jobId', 'ASC')
          .take(1)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getOne();
        if (!job) return false;
        await handle(job);
        await manager.update(RentalJob, job.jobId, {
          status: 'done',
          processed: () => '"processed" + 1',
          worker,
        });
        return true;
      });
      if (!processed) {
        // Locked tasks are still new. A separate statement sees committed state;
        // do not confuse "all remaining tasks are locked" with "queue drained".
        const hasPendingJobs = await this.hasPendingJobs(where);
        if (!hasPendingJobs) return;
        await delay(25);
      }
    }
  }

  private hasPendingJobs(where: FindOptionsWhere<RentalJob>): Promise<boolean> {
    return this.dataSource.getRepository(RentalJob).existsBy(where);
  }
}
