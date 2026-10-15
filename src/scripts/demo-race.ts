import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import { DatabaseModule } from '../database/database.module';
import { GameCopy, Rental, RentalJob, Renter } from '../database/entities';
import { createRaceData, raceSettings } from '../database/fixtures/race-data';
import { CheckoutError } from '../rentals/checkout';
import { RentalsModule } from '../rentals/rentals.module';
import { RentalsService } from '../rentals/rentals.service';

// Reuse the application's database setup and service without HTTP configuration.
@Module({ imports: [DatabaseModule, RentalsModule] })
class RaceDemoModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(RaceDemoModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await runRace(app.get(DataSource), app.get(RentalsService));
  } finally {
    await app.close();
  }
}

async function runRace(db: DataSource, rentals: RentalsService): Promise<void> {
  const fixture = await db.transaction(createRaceData);
  const started = performance.now();
  // Start all fifty calls before waiting; the database pool supplies connections.
  const outcomes = await Promise.allSettled(
    fixture.renters.map(renter =>
      rentals.checkout({
        renterId: renter.renterId,
        gameId: fixture.gameId,
        platformId: fixture.platformId,
      }),
    ),
  );
  const elapsedMs = Math.round(performance.now() - started);
  let successful = 0;
  let unavailable = 0;
  const unexpectedErrors: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') {
      successful++;
    } else {
      const error: unknown = outcome.reason;
      if (error instanceof CheckoutError && error.code === 'COPY_UNAVAILABLE') unavailable++;
      else unexpectedErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const state = await readRaceState(
    db,
    fixture.gameId,
    fixture.renters.map(renter => renter.renterId),
  );
  const report = {
    gameId: fixture.gameId,
    attempts: outcomes.length,
    initialStock: raceSettings.copies,
    successful,
    unavailable,
    unexpectedErrors,
    ...state,
    elapsedMs,
  };
  console.log(JSON.stringify(report, null, 2));

  assert.deepEqual(unexpectedErrors, [], 'Unexpected checkout errors');
  assert.equal(outcomes.length, raceSettings.attempts);
  assert.equal(successful, raceSettings.copies);
  assert.equal(unavailable, raceSettings.attempts - raceSettings.copies);
  assert.deepEqual(
    state,
    {
      finalStock: 0,
      negativeStockRows: 0,
      doubleBookedCopies: 0,
      rentals: raceSettings.copies,
      rentalItems: raceSettings.copies,
      jobs: raceSettings.copies,
      totalCharged: raceSettings.copies * raceSettings.price,
    },
    'Database state must match ten successful rentals',
  );
}

async function readRaceState(db: DataSource, gameId: string, renterIds: string[]) {
  const copies = await db.getRepository(GameCopy).find({
    where: { gameId },
    relations: { rentalItems: true },
  });
  const renters = await db.getRepository(Renter).findBy({ renterId: In(renterIds) });
  const rentals = await db.getRepository(Rental).find({
    where: { renterId: In(renterIds) },
    relations: { items: true },
  });
  const jobs = await db.getRepository(RentalJob).countBy({
    rentalId: In(rentals.map(rental => rental.rentalId)),
  });
  // A physical copy has capacity 1. Two active rentals would make its stock -1.
  const stock = copies.map(
    copy => 1 - copy.rentalItems.filter(item => item.returnedAt === null).length,
  );
  const doubleBookedCopies = stock.filter(remaining => remaining < 0).length;
  return {
    finalStock: stock.filter(remaining => remaining > 0).length,
    negativeStockRows: doubleBookedCopies,
    doubleBookedCopies,
    rentals: rentals.length,
    rentalItems: rentals.reduce((sum, rental) => sum + rental.items.length, 0),
    jobs,
    totalCharged:
      raceSettings.attempts * raceSettings.balance -
      renters.reduce((sum, renter) => sum + renter.balance, 0),
  };
}

main().catch((error: unknown) => {
  console.error('Race demo failed:', error);
  process.exitCode = 1;
});
