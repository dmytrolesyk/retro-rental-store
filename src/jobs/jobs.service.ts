import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { DataSource, In } from 'typeorm';
import type { FindOptionsWhere } from 'typeorm';
import { RentalJob } from './entities/rental-job.entity';

type JobHandler = (job: RentalJob) => Promise<unknown>;

@Injectable()
export class JobsService {
  constructor(private readonly db: DataSource) {}

  async runWorker(worker: string, handle: JobHandler, jobIds?: string[]): Promise<void> {
    const where = jobIds
      ? { status: 'new' as const, jobId: In(jobIds) }
      : { status: 'new' as const };
    // This loop ends only once the queue has no remaining new tasks.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const processed = await this.db.transaction('READ COMMITTED', async manager => {
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
    return this.db.getRepository(RentalJob).existsBy(where);
  }
}
