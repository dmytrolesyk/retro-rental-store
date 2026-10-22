import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { rentalEntities, RentalJob, Renter } = require('../dist/database/entities');
const { JobsService } = require('../dist/jobs/jobs.service');
const { EmailService } = require('../dist/email/email.service');
const { RentalConfirmationWorker } = require('../dist/jobs/rental-confirmation.worker');
const { checkout } = require('../dist/rentals/checkout');
const { createRaceData } = require('../dist/database/fixtures/race-data');
const { setTimeout: delay } = require('node:timers/promises');
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

async function createJob() {
  const fixture = await db.transaction(createRaceData);
  const renter = fixture.renters[0];
  const result = await checkout(db, {
    renterId: renter.renterId,
    gameId: fixture.gameId,
    platformId: fixture.platformId,
  });
  return { ...result, renter };
}

test('a failure after provider acceptance rolls back the task; retry keeps its payload and key', async () => {
  const { jobId, renter } = await createJob();
  const calls = [];
  const email = new EmailService(
    {
      emails: {
        send: async (...args) => {
          calls.push(args);
          return { data: { id: 'accepted-email' }, error: null };
        },
      },
    },
    'Rentals <notifications@send.example.com>',
  );
  const workers = new JobsService(db);
  const confirmation = new RentalConfirmationWorker(workers, email);
  await assert.rejects(
    workers.runWorker(
      'failed',
      async job => {
        await confirmation.process(job);
        throw new Error('crash before commit');
      },
      [jobId],
    ),
    /crash before commit/,
  );
  const rolledBack = await db.getRepository(RentalJob).findOneByOrFail({ jobId });
  assert.equal(rolledBack.status, 'new');
  assert.equal(rolledBack.processed, 0);
  assert.equal(rolledBack.worker, null);
  await db
    .getRepository(Renter)
    .update(renter.renterId, { email: `${renter.renterId}-changed@example.test` });
  await confirmation.run([jobId]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][0].to, renter.email);
  assert.equal(calls[0][1].idempotencyKey, `rental-confirmation/${jobId}`);
  assert.equal((await db.getRepository(RentalJob).findOneByOrFail({ jobId })).processed, 1);
});

test('SKIP LOCKED worker waits for a locked new task instead of exiting; rollback makes it available', async () => {
  const { jobId } = await createJob();
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  let completed = false;
  let calls = 0;
  let pending;
  try {
    await runner.query('SELECT job_id FROM rental_jobs WHERE job_id=$1 FOR UPDATE', [jobId]);
    pending = new JobsService(db)
      .runWorker(
        'waiting',
        async () => {
          calls++;
        },
        [jobId],
      )
      .then(() => {
        completed = true;
      });
    await delay(100);
    assert.equal(completed, false);
    assert.equal(calls, 0);
    await runner.rollbackTransaction();
    await pending;
    assert.equal(calls, 1);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await pending;
  }
});

test('two concurrent workers finish each task once and leave unrelated new tasks alone', async () => {
  const unrelated = await createJob();
  const result = spawnSync(process.execPath, ['dist/scripts/demo-workers.js'], {
    env: demoEnv,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.tasks, 10);
  assert.equal(report.processedTwice, 0);
  assert.equal(Object.keys(report.distribution).length, 2);
  assert.ok(report.elapsedMs < report.sequentialMs);
  const job = await db.getRepository(RentalJob).findOneByOrFail({ jobId: unrelated.jobId });
  assert.equal(job.status, 'new');
  console.log(JSON.stringify(report));
});

test('real-email CLI wires Nest, checkout and Resend SDK without sending network traffic', async () => {
  const intercept = `globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://api.resend.com/emails') throw new Error('Unexpected network request');
    console.log(JSON.stringify({ testRequest: JSON.parse(options.body),
      key: new Headers(options.headers).get('idempotency-key') }));
    return new Response(JSON.stringify({ id: 'provider-test-id' }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };`;
  const runEmail = (entryPoint, args = []) =>
    spawnSync(
      process.execPath,
      ['--import', `data:text/javascript,${encodeURIComponent(intercept)}`, entryPoint, ...args],
      {
        env: {
          ...demoEnv,
          RESEND_API_KEY: 're_test_not_real',
          EMAIL_FROM: 'Rentals <notifications@send.example.com>',
          DEMO_EMAIL_TO: 'delivered@resend.dev',
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = runEmail('dist/scripts/demo-email.js');
    assert.equal(result.status, 0, result.stderr);
    const request = JSON.parse(result.stdout.split('\n').find(line => line.startsWith('{')));
    assert.equal(request.testRequest.to, 'delivered@resend.dev');
    const jobId = request.key.replace('rental-confirmation/', '');
    const job = await db.getRepository(RentalJob).findOneByOrFail({ jobId });
    assert.equal(job.status, 'done');
    assert.equal(job.processed, 1);
    const repeat = runEmail('dist/worker/main.js', [jobId]);
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.ok(!repeat.stdout.includes('testRequest'), 'A completed task must not call Resend');
  }
  const { jobId } = await createJob();
  const pending = runEmail('dist/worker/main.js', [jobId]);
  assert.equal(pending.status, 0, pending.stderr);
  const request = JSON.parse(pending.stdout.split('\n').find(line => line.startsWith('{')));
  assert.equal(request.key, `rental-confirmation/${jobId}`);
  const processed = await db.getRepository(RentalJob).findOneByOrFail({ jobId });
  assert.equal(processed.status, 'done');
  assert.equal(processed.processed, 1);
  const missingId = runEmail('dist/worker/main.js');
  assert.equal(missingId.status, 1);
  assert.ok(!missingId.stdout.includes('testRequest'));
});
