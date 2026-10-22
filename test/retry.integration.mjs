import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { rentalEntities, Renter } = require('../dist/database/entities');
const { TransactionRetryService } = require('../dist/database/transaction-retry.service');
const { randomUUID } = require('node:crypto');
let db;
let demoEnv;

before(async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'Set TEST_DATABASE_URL to an empty, disposable PostgreSQL database');
  const parsed = new URL(url);
  assert.match(parsed.pathname, /^\/retro_hw14_test_[a-z0-9_]+$/);
  db = new DataSource({
    type: 'postgres',
    url,
    entities: rentalEntities,
    synchronize: false,
    installExtensions: false,
    migrations: [fileURLToPath(new URL('../dist/migrations/*.js', import.meta.url))],
  });
  await db.initialize();
  const [{ tables }] = await db.query(
    `SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  assert.equal(tables, 0, 'Use an empty database; this test does not reset existing data');
  await db.runMigrations();
  demoEnv = {
    ...process.env,
    DB_HOST: parsed.hostname,
    DB_PORT: parsed.port,
    DB_USER: decodeURIComponent(parsed.username),
    DB_PASSWORD: decodeURIComponent(parsed.password),
    DB_NAME: parsed.pathname.slice(1),
  };
  delete demoEnv.DB_PASSWORD_FILE;
  delete demoEnv.PORT;
});

after(async () => {
  if (db?.isInitialized) await db.destroy();
});

function runDemo() {
  return spawnSync(process.execPath, ['dist/scripts/demo-retry.js'], {
    env: demoEnv,
    encoding: 'utf8',
    timeout: 15000,
  });
}

async function createRenter() {
  const renterId = randomUUID();
  await db.getRepository(Renter).insert({
    renterId,
    name: 'Retry integration',
    email: `${renterId}@example.test`,
    phoneNumber: renterId,
    balance: 10000,
  });
  return renterId;
}

test('CLI causes a real 40001 and reruns safely without resetting prior balances', () => {
  const first = runDemo();
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.equal(report.initialBalance, 10000);
  assert.equal(report.finalBalance, 13000);
  assert.ok(report.retries.some(event => event.code === '40001'));
  assert.ok(report.attempts.A >= 1 && report.attempts.B >= 1);
  assert.equal(report.attempts.A + report.attempts.B, 2 + report.retries.length);
  console.log(JSON.stringify(report));
  const second = runDemo();
  assert.equal(second.status, 0, second.stderr);
  const another = JSON.parse(second.stdout);
  assert.notEqual(another.renterId, report.renterId);
  assert.equal(another.finalBalance, 13000);
  return db
    .getRepository(Renter)
    .findOneByOrFail({ renterId: report.renterId })
    .then(renter => assert.equal(renter.balance, 13000));
});

test('CLI accepts additional retryable SQL failures without rejecting a correct final balance', async () => {
  await db.query('CREATE SEQUENCE retry_extra_conflicts');
  await db.query(`CREATE FUNCTION add_retry_conflict() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF nextval('retry_extra_conflicts') = 1 THEN
        RAISE EXCEPTION 'additional serialization conflict' USING ERRCODE = '40001';
      END IF;
      RETURN NEW;
    END; $$`);
  try {
    await db.query(`CREATE TRIGGER add_retry_conflict BEFORE UPDATE ON renters
      FOR EACH ROW WHEN (OLD.name = 'Retry demo renter') EXECUTE FUNCTION add_retry_conflict()`);
    const result = runDemo();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.finalBalance, 13000);
    assert.ok(report.retries.length >= 2);
    assert.equal(report.attempts.A + report.attempts.B, 2 + report.retries.length);
    assert.ok(report.retries.every(event => ['40001', '40P01'].includes(event.code)));
  } finally {
    await db.query('DROP TRIGGER IF EXISTS add_retry_conflict ON renters');
    await db.query('DROP FUNCTION add_retry_conflict()');
    await db.query('DROP SEQUENCE retry_extra_conflicts');
  }
});

test('real 40P01 retries the victim transaction and commits both operations once', async () => {
  const ids = [await createRenter(), await createRenter()];
  const service = new TransactionRetryService(db);
  const retries = [];
  let lockedCount = 0;
  let release;
  const bothLocked = new Promise(resolve => {
    release = resolve;
  });
  const updateBoth = order =>
    service
      .run(
        'READ COMMITTED',
        async (manager, attempt) => {
          await manager.increment(Renter, { renterId: ids[order[0]] }, 'balance', 100);
          if (attempt === 1) {
            lockedCount++;
            if (lockedCount === 2) release();
            await bothLocked;
          }
          await manager.increment(Renter, { renterId: ids[order[1]] }, 'balance', 100);
        },
        { onRetry: event => retries.push(event) },
      )
      .catch(error => {
        release();
        throw error;
      });
  const outcomes = await Promise.allSettled([updateBoth([0, 1]), updateBoth([1, 0])]);
  for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  assert.equal(retries.length, 1);
  assert.equal(retries[0].code, '40P01');
  for (const renterId of ids) {
    assert.equal((await db.getRepository(Renter).findOneByOrFail({ renterId })).balance, 10200);
  }
});

test('repeated real 40001 failures stop at the limit and roll back earlier writes each time', async () => {
  const target = await createRenter();
  const other = await createRenter();
  const attempts = [];
  const retries = [];
  await assert.rejects(
    new TransactionRetryService(db).run(
      'REPEATABLE READ',
      async (manager, attempt) => {
        attempts.push(attempt);
        const renter = await manager.findOneByOrFail(Renter, { renterId: target });
        await manager.increment(Renter, { renterId: other }, 'balance', 500);
        // Independent committed transaction invalidates this attempt's snapshot.
        await db.getRepository(Renter).increment({ renterId: target }, 'balance', 1);
        await manager.update(Renter, target, { balance: renter.balance + 100 });
      },
      { maxAttempts: 3, onRetry: event => retries.push(event) },
    ),
    { code: '40001' },
  );
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(retries.length, 2);
  assert.equal(
    (await db.getRepository(Renter).findOneByOrFail({ renterId: target })).balance,
    10003,
  );
  assert.equal(
    (await db.getRepository(Renter).findOneByOrFail({ renterId: other })).balance,
    10000,
  );
});

test('unrelated SQL failure exits the CLI without hanging either coordinated transaction', async () => {
  const beforeIds = (await db.getRepository(Renter).find()).map(renter => renter.renterId);
  await db.query(`CREATE FUNCTION reject_retry_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced unrelated retry failure'; END; $$`);
  try {
    await db.query(`CREATE TRIGGER reject_retry_update BEFORE UPDATE ON renters
      FOR EACH ROW WHEN (OLD.name = 'Retry demo renter') EXECUTE FUNCTION reject_retry_update()`);
    const result = runDemo();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /forced unrelated retry failure/);
    assert.equal(result.signal, null, 'The CLI should fail itself, not be killed by the timeout');
    const newRenters = (await db.getRepository(Renter).find()).filter(
      renter => !beforeIds.includes(renter.renterId),
    );
    assert.equal(newRenters.length, 1);
    assert.equal(newRenters[0].balance, 10000);
  } finally {
    await db.query('DROP TRIGGER IF EXISTS reject_retry_update ON renters');
    await db.query('DROP FUNCTION reject_retry_update()');
  }
});
