import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const {
  rentalEntities,
  Renter,
  Rental,
  RentalItem,
  RentalJob,
} = require('../dist/database/entities');
const { checkout, CheckoutError } = require('../dist/rentals/checkout');
let dataSource;

before(async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'Set TEST_DATABASE_URL to an empty, disposable PostgreSQL database');
  assert.match(new URL(url).pathname, /^\/retro_hw14_test_[a-z0-9_]+$/);
  dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: rentalEntities,
    synchronize: false,
    installExtensions: false,
    poolSize: 5,
    extra: { application_name: 'hw14-checkout-test', statement_timeout: 5000 },
    migrations: [fileURLToPath(new URL('../dist/migrations/*.js', import.meta.url))],
  });
  await dataSource.initialize();
  const [{ tables }] = await dataSource.query(
    `SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  assert.equal(tables, 0, 'Use an empty test database; existing data is never reset');
  await dataSource.runMigrations();
});

after(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

async function fixture({ copies = 1, balance = 10000 } = {}) {
  const gameId = randomUUID();
  const platformId = randomUUID();
  await dataSource.query(
    `INSERT INTO games (game_id, name, name_uk, description, description_uk)
    VALUES ($1, 'Checkout test', 'Тест оренди', '', '')`,
    [gameId],
  );
  await dataSource.query(
    `INSERT INTO platforms (platform_id, name, description, description_uk, release_date)
    VALUES ($1, $2, '', '', '2000-01-01')`,
    [platformId, platformId],
  );
  const copyIds = Array.from({ length: copies }, () => randomUUID()).sort();
  for (const id of copyIds) {
    await dataSource.query(
      `INSERT INTO game_copies (game_copy_id, game_id, platform_id, condition, format, price_per_day)
      VALUES ($1, $2, $3, 'good', 'cartridge', 2500)`,
      [id, gameId, platformId],
    );
  }
  const renters = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    renters.push(
      await dataSource.getRepository(Renter).save({
        renterId: id,
        name: 'Test renter',
        email: `${id}@example.test`,
        phoneNumber: id,
        balance: balance,
      }),
    );
  }
  const request = { gameId, platformId, renterId: renters[0].renterId };
  return { request, copyIds, renters };
}

async function state(renterId) {
  const renter = await dataSource.getRepository(Renter).findOneByOrFail({ renterId });
  const rentals = await dataSource.getRepository(Rental).findBy({ renterId });
  const items = [];
  const jobs = [];
  for (const rental of rentals) {
    items.push(
      ...(await dataSource.getRepository(RentalItem).findBy({ rentalId: rental.rentalId })),
    );
    jobs.push(...(await dataSource.getRepository(RentalJob).findBy({ rentalId: rental.rentalId })));
  }
  return { balance: renter.balance, rentals, items, jobs };
}

function businessError(code) {
  return error => error instanceof CheckoutError && error.code === code;
}

test('checkout charges one day and commits rental, item, and confirmation job together', async () => {
  const { request, copyIds } = await fixture();
  const checkoutReceipt = await checkout(dataSource, request);
  const saved = await state(request.renterId);
  assert.equal(checkoutReceipt.gameCopyId, copyIds[0]);
  assert.equal(checkoutReceipt.chargedAmount, 2500);
  assert.equal(checkoutReceipt.balance, 7500);
  assert.equal(saved.balance, 7500);
  assert.equal(saved.rentals.length, 1);
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].returnedAt, null);
  assert.equal(saved.jobs.length, 1);
  assert.equal(saved.jobs[0].status, 'new');
  assert.equal(saved.jobs[0].processed, 0);
  assert.equal(saved.jobs[0].rentalId, checkoutReceipt.rentalId);
  assert.equal(saved.jobs[0].jobId, checkoutReceipt.jobId);
  await dataSource.query(
    'UPDATE game_copies SET price_per_day = 3000 WHERE game_copy_id = $1',
    copyIds,
  );
  assert.equal((await state(request.renterId)).items[0].costPerDay, 2500);
});

test('insufficient balance leaves no partial rental or job and releases the copy', async () => {
  const { request, renters } = await fixture({ balance: 2499 });
  const original = await state(request.renterId);
  await assert.rejects(checkout(dataSource, request), businessError('INSUFFICIENT_BALANCE'));
  assert.deepEqual(await state(request.renterId), original);
  await dataSource.getRepository(Renter).update(renters[1].renterId, { balance: 2500 });
  await checkout(dataSource, { ...request, renterId: renters[1].renterId });
  assert.equal((await state(renters[1].renterId)).balance, 0);
});

test('missing copies and already rented copies are business refusals without charges', async () => {
  const empty = await fixture({ copies: 0 });
  const original = await state(empty.request.renterId);
  await assert.rejects(checkout(dataSource, empty.request), businessError('COPY_UNAVAILABLE'));
  assert.deepEqual(await state(empty.request.renterId), original);
  const { request, renters } = await fixture();
  await checkout(dataSource, request);
  const other = { ...request, renterId: renters[1].renterId };
  const otherOriginal = await state(other.renterId);
  await assert.rejects(checkout(dataSource, other), businessError('COPY_UNAVAILABLE'));
  assert.deepEqual(await state(other.renterId), otherOriginal);
});

test('unknown renter and malformed IDs are explicit business errors', async () => {
  const { request } = await fixture();
  await assert.rejects(
    checkout(dataSource, { ...request, renterId: randomUUID() }),
    businessError('RENTER_NOT_FOUND'),
  );
  await assert.rejects(
    checkout(dataSource, { ...request, gameId: 'invalid' }),
    businessError('INVALID_INPUT'),
  );
});

test('renter existence is checked before searching for available copies', async () => {
  const { request } = await fixture({ copies: 0 });
  await assert.rejects(
    checkout(dataSource, { ...request, renterId: randomUUID() }),
    businessError('RENTER_NOT_FOUND'),
  );
});

test('RentalsService resolves from AppModule and runs checkout without an HTTP server', async () => {
  const { request } = await fixture();
  const url = new URL(process.env.TEST_DATABASE_URL);
  const overrides = {
    DB_HOST: url.hostname,
    DB_PORT: url.port,
    DB_USER: decodeURIComponent(url.username),
    DB_PASSWORD: decodeURIComponent(url.password),
    DB_NAME: url.pathname.slice(1),
    DB_PASSWORD_FILE: undefined,
    PORT: '3000',
  };
  const original = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  let app;
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('../dist/app.module');
    const { RentalsService } = require('../dist/rentals/rentals.service');
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
      abortOnError: false,
    });
    const checkoutReceipt = await app.get(RentalsService).checkout(request);
    assert.equal(checkoutReceipt.balance, 7500);
    assert.equal((await state(request.renterId)).jobs[0].jobId, checkoutReceipt.jobId);
  } finally {
    if (app) await app.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
});

test('a real failure inserting the job rolls back payment and all rental rows', async () => {
  const { request } = await fixture();
  const original = await state(request.renterId);
  await dataSource.query(`CREATE FUNCTION reject_checkout_job() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced job insert failure'; END; $$`);
  try {
    await dataSource.query(`CREATE TRIGGER reject_checkout_job BEFORE INSERT ON rental_jobs
      FOR EACH ROW EXECUTE FUNCTION reject_checkout_job()`);
    await assert.rejects(
      checkout(dataSource, request),
      error => !(error instanceof CheckoutError) && error.code === 'P0001',
    );
    assert.deepEqual(await state(request.renterId), original);
  } finally {
    await dataSource.query('DROP TRIGGER IF EXISTS reject_checkout_job ON rental_jobs');
    await dataSource.query('DROP FUNCTION reject_checkout_job()');
  }
  await checkout(dataSource, request);
});

test('two concurrent requests cannot rent the same physical copy', async () => {
  const { request, renters } = await fixture();
  const checkoutOutcomes = await Promise.allSettled(
    renters.map(renter => checkout(dataSource, { ...request, renterId: renter.renterId })),
  );
  assert.equal(
    checkoutOutcomes.filter(checkoutOutcome => checkoutOutcome.status === 'fulfilled').length,
    1,
  );
  const rejected = checkoutOutcomes.find(checkoutOutcome => checkoutOutcome.status === 'rejected');
  assert.ok(businessError('COPY_UNAVAILABLE')(rejected.reason));
  const states = await Promise.all(renters.map(renter => state(renter.renterId)));
  assert.equal(
    states.reduce((sum, saved) => sum + saved.balance, 0),
    17500,
  );
  assert.equal(
    states.reduce((sum, saved) => sum + saved.items.length, 0),
    1,
  );
  assert.equal(
    states.reduce((sum, saved) => sum + saved.jobs.length, 0),
    1,
  );
});

test('concurrent requests cannot spend the same renter balance twice', async () => {
  const { request } = await fixture({ balance: 2500 });
  const otherGame = await fixture();
  // Different games/copies avoid serializing on the same copy lock: only the balance is shared.
  const otherRequest = { ...otherGame.request, renterId: request.renterId };
  const checkoutOutcomes = await Promise.allSettled([
    checkout(dataSource, request),
    checkout(dataSource, otherRequest),
  ]);
  assert.equal(
    checkoutOutcomes.filter(checkoutOutcome => checkoutOutcome.status === 'fulfilled').length,
    1,
  );
  assert.ok(
    businessError('INSUFFICIENT_BALANCE')(
      checkoutOutcomes.find(checkoutOutcome => checkoutOutcome.status === 'rejected').reason,
    ),
  );
  const saved = await state(request.renterId);
  assert.equal(saved.balance, 0);
  assert.equal(saved.items.length, 1);
  assert.equal(saved.jobs.length, 1);
});

async function waitForDatabaseLock(queryPart = 'game_copies') {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const [{ waiting }] = await dataSource.query(
      `SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
      AND application_name = 'hw14-checkout-test' AND wait_event_type = 'Lock'
      AND query ILIKE $1) AS waiting`,
      [`%${queryPart}%`],
    );
    if (waiting) return;
    await delay(10);
  }
  assert.fail(`Expected a database lock wait for ${queryPart}`);
}

test('the renter cannot be deleted between the early existence check and payment', async () => {
  const { request, copyIds } = await fixture();
  const holder = dataSource.createQueryRunner();
  await holder.connect();
  let pending;
  let deletion;
  try {
    await holder.startTransaction();
    await holder.query('SELECT game_copy_id FROM game_copies WHERE game_copy_id = $1 FOR UPDATE', [
      copyIds[0],
    ]);
    pending = checkout(dataSource, request);
    pending.catch(() => {});
    await waitForDatabaseLock();
    deletion = dataSource
      .getRepository(Renter)
      .delete(request.renterId)
      .then(
        () => ({ deleted: true }),
        error => ({ error }),
      );
    await waitForDatabaseLock('DELETE FROM "renters"');
    await holder.rollbackTransaction();
    await pending;
    const deletionResult = await deletion;
    assert.ok(deletionResult.error, 'Deletion must fail after checkout creates a rental');
    assert.ok(['23001', '23503'].includes(deletionResult.error.code));
    assert.equal((await state(request.renterId)).balance, 7500);
  } finally {
    if (holder.isTransactionActive) await holder.rollbackTransaction();
    await holder.release();
    await Promise.allSettled([pending, deletion]);
  }
});

for (const commitReservation of [true, false]) {
  test(`after waiting for a copy lock, recheck availability (${commitReservation ? 'commit' : 'rollback'})`, async () => {
    const { request, copyIds, renters } = await fixture({ copies: commitReservation ? 2 : 1 });
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    let pending;
    try {
      await holder.startTransaction();
      await holder.query(
        'SELECT game_copy_id FROM game_copies WHERE game_copy_id = $1 FOR UPDATE',
        [copyIds[0]],
      );
      pending = checkout(dataSource, request);
      // Attach a rejection handler immediately while the test coordinates the other transaction.
      pending.catch(() => {});
      await waitForDatabaseLock();
      if (commitReservation) {
        const rental = await holder.manager.save(Rental, {
          renterId: renters[1].renterId,
          rentedAt: new Date(),
        });
        await holder.manager.insert(RentalItem, {
          rentalId: rental.rentalId,
          gameCopyId: copyIds[0],
          costPerDay: 2500,
        });
        await holder.commitTransaction();
      } else {
        await holder.rollbackTransaction();
      }
      const checkoutReceipt = await pending;
      assert.equal(checkoutReceipt.gameCopyId, copyIds[commitReservation ? 1 : 0]);
      assert.equal((await state(request.renterId)).balance, 7500);
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
      if (pending) await Promise.allSettled([pending]);
    }
  });
}
