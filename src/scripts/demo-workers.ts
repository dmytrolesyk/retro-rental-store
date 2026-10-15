import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import { DatabaseModule } from '../database/database.module';
import { RentalJob } from '../database/entities';
import { createRaceData, raceSettings } from '../database/fixtures/race-data';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { RentalsModule } from '../rentals/rentals.module';
import { RentalsService } from '../rentals/rentals.service';

@Module({ imports: [DatabaseModule, RentalsModule, JobsModule] })
class WorkersDemoModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkersDemoModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const db = app.get(DataSource);
    const fixture = await db.transaction(createRaceData);
    const jobIds: string[] = [];
    for (const renter of fixture.renters.slice(0, raceSettings.copies)) {
      const result = await app.get(RentalsService).checkout({
        renterId: renter.renterId,
        gameId: fixture.gameId,
        platformId: fixture.platformId,
      });
      jobIds.push(result.jobId);
    }
    const durationMs = 500;
    const started = performance.now();
    // Only these demo tasks: never consume unrelated real email tasks here.
    const outcomes = await Promise.allSettled(
      ['worker-1', 'worker-2'].map(worker =>
        app.get(JobsService).runWorker(worker, () => delay(durationMs), jobIds),
      ),
    );
    const elapsedMs = Math.round(performance.now() - started);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') throw outcome.reason;
    }
    const jobs = await db.getRepository(RentalJob).findBy({ jobId: In(jobIds) });
    const distribution: Record<string, number> = {};
    for (const job of jobs) {
      if (job.worker) distribution[job.worker] = (distribution[job.worker] ?? 0) + 1;
    }
    const processedTwice = jobs.filter(job => job.processed > 1).length;
    const sequentialMs = jobs.length * durationMs;
    console.log(
      JSON.stringify(
        { tasks: jobs.length, distribution, processedTwice, elapsedMs, sequentialMs },
        null,
        2,
      ),
    );
    assert.equal(jobs.length, jobIds.length);
    assert.ok(jobs.every(job => job.status === 'done' && job.processed === 1));
    assert.equal(processedTwice, 0);
    assert.ok(Object.keys(distribution).length >= 2);
    assert.ok(elapsedMs < sequentialMs, 'Workers must outperform sequential processing');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Workers demo failed:', error);
  process.exitCode = 1;
});
