import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { rentalEntities } = require('../dist/database/entities');
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
  return spawnSync(process.execPath, ['dist/scripts/demo-race.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: demoEnv,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('race CLI rents exactly ten copies in fifty attempts and can rerun without resetting prior data', async () => {
  await db.query(`INSERT INTO renters (name, email, phone_number, balance)
    VALUES ('Existing renter', 'sentinel@example.test', 'sentinel', 12345)`);
  const firstRun = runDemo();
  assert.equal(firstRun.status, 0, firstRun.stderr);
  const first = JSON.parse(firstRun.stdout);
  assert.equal(first.attempts, 50);
  assert.equal(first.successful, 10);
  assert.equal(first.unavailable, 40);
  assert.equal(first.finalStock, 0);
  assert.equal(first.negativeStockRows, 0);
  assert.equal(first.doubleBookedCopies, 0);
  assert.equal(first.rentals, 10);
  assert.equal(first.rentalItems, 10);
  assert.equal(first.jobs, 10);
  assert.equal(first.totalCharged, 25000);
  assert.deepEqual(first.unexpectedErrors, []);

  const secondRun = runDemo();
  assert.equal(secondRun.status, 0, secondRun.stderr);
  const second = JSON.parse(secondRun.stdout);
  assert.notEqual(second.gameId, first.gameId);
  assert.equal(second.successful, 10);
  assert.equal(second.finalStock, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rentals'))[0].n, 20);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rental_jobs'))[0].n, 20);
  assert.equal(
    (await db.query("SELECT balance FROM renters WHERE email = 'sentinel@example.test'"))[0]
      .balance,
    12345,
  );
});

test('race CLI fails on unexpected database errors and waits for all rollbacks', async () => {
  const [{ n: before }] = await db.query('SELECT count(*)::int AS n FROM rentals');
  await db.query(`CREATE FUNCTION reject_race_job() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced race job failure'; END; $$`);
  try {
    await db.query(`CREATE TRIGGER reject_race_job BEFORE INSERT ON rental_jobs
      FOR EACH ROW EXECUTE FUNCTION reject_race_job()`);
    const result = runDemo();
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.attempts, 50);
    assert.equal(report.successful, 0);
    assert.equal(report.unexpectedErrors.length, 50);
    assert.equal(report.finalStock, 10);
    assert.equal(report.totalCharged, 0);
    assert.equal(report.rentals, 0);
    assert.equal(report.jobs, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM rentals'))[0].n, before);
  } finally {
    await db.query('DROP TRIGGER IF EXISTS reject_race_job ON rental_jobs');
    await db.query('DROP FUNCTION reject_race_job()');
  }
});

test('race CLI fails if the database charges an incorrect total', async () => {
  await db.query(`CREATE FUNCTION change_race_payment() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE renters SET balance = balance + 1
      WHERE renter_id = (SELECT renter_id FROM rentals WHERE rental_id = NEW.rental_id);
      RETURN NEW;
    END; $$`);
  try {
    await db.query(`CREATE TRIGGER change_race_payment AFTER INSERT ON rental_jobs
      FOR EACH ROW EXECUTE FUNCTION change_race_payment()`);
    const result = runDemo();
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.successful, 10);
    assert.equal(report.totalCharged, 24990);
    assert.deepEqual(report.unexpectedErrors, []);
  } finally {
    await db.query('DROP TRIGGER IF EXISTS change_race_payment ON rental_jobs');
    await db.query('DROP FUNCTION change_race_payment()');
  }
});
