import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { Renter } from '../database/entities';
import { createRaceData } from '../database/fixtures/race-data';
import { RentalConfirmationWorker } from '../jobs/rental-confirmation.worker';
import { RentalsModule } from '../rentals/rentals.module';
import { RentalsService } from '../rentals/rentals.service';
import { WorkerModule } from '../worker/worker.module';

@Module({ imports: [WorkerModule, RentalsModule] })
class EmailDemoModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(EmailDemoModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const to = z
      .email()
      .max(120)
      .parse(process.env.DEMO_EMAIL_TO ?? 'delivered@resend.dev');
    const db = app.get(DataSource);
    const fixture = await db.transaction(createRaceData);
    const renter = (await db.getRepository(Renter).findOneBy({ email: to })) ?? fixture.renters[0];
    await db.getRepository(Renter).update(renter.renterId, { email: to });
    const result = await app.get(RentalsService).checkout({
      renterId: renter.renterId,
      gameId: fixture.gameId,
      platformId: fixture.platformId,
    });
    console.log(
      `Created email task ${result.jobId}; retry with: pnpm start:worker ${result.jobId}`,
    );
    await app.get(RentalConfirmationWorker).run([result.jobId]);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Email demo failed:', error);
  process.exitCode = 1;
});
