import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { rentalEntities, Renter, Rental } = require('../dist/database/entities');
const {
  InitialRentalSchema1791301576818,
} = require('../dist/migrations/1791301576818-InitialRentalSchema');

test('balance and job migration enforces constraints and preserves existing rentals on rollback', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'Set TEST_DATABASE_URL to an empty, disposable PostgreSQL database');
  assert.match(
    new URL(url).pathname,
    /^\/retro_hw14_test_[a-z0-9_]+$/,
    'Only a dedicated retro_hw14_test_* database is allowed',
  );

  const connection = {
    type: 'postgres',
    url,
    entities: rentalEntities,
    synchronize: false,
    installExtensions: false,
  };
  const baseline = new DataSource({
    ...connection,
    migrations: [InitialRentalSchema1791301576818],
  });
  await baseline.initialize();
  try {
    const [{ tables }] = await baseline.query(
      `SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    assert.equal(tables, 0, 'Use an empty test database; this test does not reset existing data');
    await baseline.runMigrations();
    await baseline.query(
      `INSERT INTO renters (renter_id, name, email, phone_number) VALUES ($1, 'Existing renter', 'existing@example.test', '+380000000001')`,
      ['20000000-0000-4000-8000-000000000001'],
    );
    await baseline.query(
      `INSERT INTO rentals (rental_id, renter_id, rented_at) VALUES ($1, $2, now())`,
      ['30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'],
    );
  } finally {
    await baseline.destroy();
  }

  const db = new DataSource({
    ...connection,
    migrations: [fileURLToPath(new URL('../dist/migrations/*.js', import.meta.url))],
  });
  await db.initialize();
  try {
    const applied = await db.runMigrations();
    assert.equal(applied.length, 2, 'A new migration must extend the existing homework schema');
    const existingId = '20000000-0000-4000-8000-000000000001';
    assert.equal(
      (await db.getRepository(Renter).findOneByOrFail({ renterId: existingId })).balance,
      0,
    );

    const renter = await db.getRepository(Renter).save({
      name: 'New renter',
      email: 'new@example.test',
      phoneNumber: '+380000000002',
    });
    assert.equal(renter.balance, 0);
    await db.getRepository(Renter).update(renter.renterId, { balance: 10000 });
    await assert.rejects(
      db.query('UPDATE renters SET balance = -1 WHERE renter_id = $1', [renter.renterId]),
      { code: '23514' },
    );
    await assert.rejects(
      db.query('UPDATE renters SET balance = NULL WHERE renter_id = $1', [renter.renterId]),
      { code: '23502' },
    );

    const { RentalJob } = require('../dist/database/entities');
    const rentalId = '30000000-0000-4000-8000-000000000001';
    const jobs = db.getRepository(RentalJob);
    const job = await jobs.save({ rentalId, emailTo: 'existing@example.test' });
    assert.equal(job.status, 'new');
    assert.equal(job.processed, 0);
    assert.equal(job.worker, null);
    assert.ok(job.createdAt instanceof Date);
    assert.equal(
      (await jobs.findOneOrFail({ where: { jobId: job.jobId }, relations: { rental: true } }))
        .rental.rentalId,
      rentalId,
    );
    await assert.rejects(jobs.insert({ rentalId: randomUUID(), emailTo: 'delivered@resend.dev' }), {
      code: '23503',
    });
    await assert.rejects(
      db.query("UPDATE rental_jobs SET status = 'invalid' WHERE job_id = $1", [job.jobId]),
      { code: '23514' },
    );
    await assert.rejects(
      db.query('UPDATE rental_jobs SET processed = -1 WHERE job_id = $1', [job.jobId]),
      { code: '23514' },
    );
    await assert.rejects(
      db.query('UPDATE rental_jobs SET processed = NULL WHERE job_id = $1', [job.jobId]),
      { code: '23502' },
    );
    await assert.rejects(
      db.getRepository(Rental).delete(rentalId),
      error =>
        ['23001', '23503'].includes(error.code) &&
        error.constraint === 'rental_jobs_rental_id_fkey',
    );
    await jobs.update(job.jobId, { status: 'done', processed: 1, worker: 'worker-1' });
    assert.equal((await jobs.findOneByOrFail({ jobId: job.jobId })).processed, 1);

    // Compare the migration with ORM metadata, including existing manual schema objects.
    const diff = await db.driver.createSchemaBuilder().log();
    assert.deepEqual(
      diff.upQueries.map(query => query.query),
      [],
      'Entities and migrated schema must agree',
    );

    await db.undoLastMigration();
    await db.query("UPDATE renters SET email = 'backfill@example.test' WHERE renter_id = $1", [
      existingId,
    ]);
    assert.equal((await db.runMigrations()).length, 1);
    assert.equal(
      (await jobs.findOneByOrFail({ jobId: job.jobId })).emailTo,
      'backfill@example.test',
    );
    await db.undoLastMigration();
    await db.undoLastMigration();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM rentals'))[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM renters'))[0].n, 2);
    assert.equal(
      (await db.query("SELECT to_regclass('public.rental_jobs') AS name"))[0].name,
      null,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'renters' AND column_name = 'balance'",
        )
      )[0].n,
      0,
    );

    assert.equal((await db.runMigrations()).length, 2);
    assert.equal(
      (await db.getRepository(Renter).findOneByOrFail({ renterId: existingId })).balance,
      0,
    );
    assert.equal(await jobs.count(), 0);
  } finally {
    await db.destroy();
  }
});
