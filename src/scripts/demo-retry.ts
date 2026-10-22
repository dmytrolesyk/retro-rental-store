import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module';
import { TransactionRetryService } from '../database/transaction-retry.service';
import type { TransactionRetryEvent } from '../database/transaction-retry.service';
import { Renter } from '../renters/entities/renter.entity';

@Module({ imports: [DatabaseModule] })
class RetryDemoModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(RetryDemoModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await runRetryDemo(app.get(DataSource), app.get(TransactionRetryService));
  } finally {
    await app.close();
  }
}

async function runRetryDemo(db: DataSource, transactions: TransactionRetryService): Promise<void> {
  const renterId = randomUUID();
  const initialBalance = 10000;
  await db.getRepository(Renter).insert({
    renterId,
    name: 'Retry demo renter',
    email: `${renterId}@example.test`,
    phoneNumber: renterId,
    balance: initialBalance,
  });
  const attempts = { A: 0, B: 0 };
  const retries: (TransactionRetryEvent & { worker: string })[] = [];
  // B captures its snapshot before A starts; B's first write waits for A's commit.
  let markSnapshotReady!: () => void;
  const snapshotReady = new Promise<void>(resolve => {
    markSnapshotReady = resolve;
  });
  let markFirstFinished!: () => void;
  const firstFinished = new Promise<void>(resolve => {
    markFirstFinished = resolve;
  });

  const addToBalance = (worker: 'A' | 'B', amount: number) =>
    transactions.run(
      'REPEATABLE READ',
      async (manager, attempt) => {
        attempts[worker]++;
        const renter = await manager.findOneByOrFail(Renter, { renterId });
        if (worker === 'B' && attempt === 1) {
          markSnapshotReady();
          await firstFinished;
        }
        // Deliberately read-modify-write: the fresh read on retry matters here.
        await manager.update(Renter, renterId, { balance: renter.balance + amount });
      },
      { onRetry: event => retries.push({ worker, ...event }) },
    );
  const second = addToBalance('B', 2000).catch((error: unknown) => {
    // If B fails before its SELECT, A must not wait forever.
    markSnapshotReady();
    throw error;
  });
  const first = (async () => {
    try {
      await snapshotReady;
      await addToBalance('A', 1000);
    } finally {
      // Also release B if A fails, so all transactions can settle before closing.
      markFirstFinished();
    }
  })();
  const outcomes = await Promise.allSettled([first, second]);
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') throw outcome.reason;
  }
  const { balance: finalBalance } = await db.getRepository(Renter).findOneByOrFail({ renterId });
  console.log(
    JSON.stringify({ renterId, initialBalance, finalBalance, attempts, retries }, null, 2),
  );
  assert.equal(finalBalance, initialBalance + 1000 + 2000);
  assert.ok(retries.length >= 1, 'The demo must exercise transaction retry');
  assert.ok(
    retries.some(event => event.code === '40001'),
    'The demo must cause a real serialization failure',
  );
  assert.ok(attempts.A >= 1 && attempts.B >= 1);
  assert.equal(
    attempts.A + attempts.B,
    2 + retries.length,
    'Each retry starts another transaction attempt',
  );
}

main().catch((error: unknown) => {
  console.error('Retry demo failed:', error);
  process.exitCode = 1;
});
