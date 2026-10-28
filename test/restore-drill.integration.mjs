import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../dist/database/data-source-options.js';

assert.match(process.env.COMPOSE_PROJECT_NAME ?? '', /^retro-hw15-test-[a-z0-9-]+$/);
let directory;
let archive;
let metadata;
let url;
let db;

function docker(...args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function run(script, environment = {}, interrupt = false) {
  const child = spawn('bash', ['scripts/with-secrets.sh', 'dev', 'bash', `scripts/${script}.sh`], {
    env: {
      ...process.env,
      SKIP_VAULT: '1',
      DATABASE_URL: url,
      BACKUP_DIR: directory,
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let interrupted = false;
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
    if (interrupt && !interrupted && stdout.includes('Resources:')) {
      interrupted = true;
      child.kill('SIGTERM');
    }
  });
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr += chunk;
  });
  const [code] = await once(child, 'close');
  return { code, stdout: stdout.trim(), stderr };
}

function assertCleaned(stdout) {
  const match = /Resources: (retro-restore-[\w-]+) (retro-restore-[\w-]+)/.exec(stdout);
  assert.ok(match, stdout);
  for (const [kind, name] of [
    ['container', match[1]],
    ['volume', match[2]],
  ]) {
    assert.throws(() => docker(kind, 'inspect', name));
  }
  return match[1];
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'retro-restore-test-'));
  const port = new URL(`http://${docker('compose', 'port', 'db', '5432')}`).port;
  const user = process.env.DB_MIGRATION_USER ?? 'db_migrator';
  const password = process.env.DB_MIGRATION_PASSWORD ?? 'migration_dev';
  url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/rental`;
  db = new DataSource(
    createDataSourceOptions({
      DB_HOST: '127.0.0.1',
      DB_PORT: port,
      DB_USER: user,
      DB_PASSWORD: password,
      DB_NAME: 'rental',
    }),
  );
  await db.initialize();
  await db.runMigrations();
  const game = randomUUID();
  const platform = randomUUID();
  await db.query(
    `INSERT INTO games (game_id, name, name_uk, description, description_uk)
     VALUES ($1, 'Restore test', 'Тест відновлення', '', '')`,
    [game],
  );
  await db.query(
    `INSERT INTO platforms (platform_id, name, description, description_uk, release_date)
     VALUES ($1, $2, '', '', '2000-01-01')`,
    [platform, platform],
  );
  await db.query(
    `INSERT INTO game_copies
     (game_copy_id, game_id, platform_id, condition, format, price_per_day)
     VALUES ($1, $2, $3, 'good', 'cartridge', 2500)`,
    [randomUUID(), game, platform],
  );
  const backup = await run('backup');
  assert.equal(backup.code, 0, backup.stderr);
  archive = backup.stdout;
  metadata = JSON.parse(await readFile(`${archive}.json`, 'utf8'));
  // Changes after the snapshot must not change what the drill expects.
  await db.query('UPDATE game_copies SET price_per_day = 3000 WHERE game_id = $1', [game]);
});

after(async () => {
  if (db?.isInitialized) await db.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('restores the latest completed snapshot twice into separate clean resources', async context => {
  // A lexically older completed archive must not be selected, regardless of mtime.
  await writeFile(join(directory, 'rental-1900-01-01T00-00-00-000Z-old.dump'), 'old archive');
  // Neither unfinished archives nor orphaned JSON should be selected.
  await writeFile(join(directory, 'rental-9999.dump.part'), 'unfinished');
  await writeFile(join(directory, 'rental-9999.dump.json'), '{}');
  const [before] = await db.query(
    'SELECT count(*)::text AS rows, sum(price_per_day)::text AS sum FROM game_copies',
  );
  const names = [];
  for (let i = 0; i < 2; i++) {
    // Recovery must not require access to the source database or its Compose stack.
    const result = await run('restore-drill', {
      DATABASE_URL: 'postgresql://unavailable:unavailable@127.0.0.1:1/offline',
      COMPOSE_PROJECT_NAME: `${process.env.COMPOSE_PROJECT_NAME}-missing`,
    });
    context.diagnostic(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^MATCH /m);
    assert.ok(
      result.stdout.includes(
        `rows=${metadata.control.rows} sumPricePerDay=${metadata.control.sumPricePerDay}`,
      ),
    );
    assert.match(result.stdout, /pg_restore: [\d.]+ seconds/);
    assert.match(result.stdout, /RTO \(create through verification\): [\d.]+ seconds/);
    names.push(assertCleaned(result.stdout));
  }
  assert.notEqual(names[0], names[1]);
  const [after] = await db.query(
    'SELECT count(*)::text AS rows, sum(price_per_day)::text AS sum FROM game_copies',
  );
  assert.deepEqual(after, before);
});

async function alteredBackup(name, change) {
  const target = join(directory, name);
  await mkdir(target);
  const destination = join(target, archive.split('/').at(-1));
  await copyFile(archive, destination);
  const altered = structuredClone(metadata);
  await change(destination, altered);
  await writeFile(`${destination}.json`, JSON.stringify(altered));
  return target;
}

test('a mismatching aggregate fails and still removes its container and volume', async () => {
  const target = await alteredBackup('mismatch', async (_file, value) => {
    value.control.sumPricePerDay = String(BigInt(value.control.sumPricePerDay) + 1n);
  });
  const result = await run('restore-drill', { BACKUP_DIR: target });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /MISMATCH/);
  assert.doesNotMatch(result.stdout, /^MATCH /m);
  assertCleaned(result.stdout);
});

test('a damaged archive fails during restore and still cleans up', async () => {
  const target = await alteredBackup('corrupt', async file => {
    await writeFile(file, 'this is not a PostgreSQL archive');
  });
  const result = await run('restore-drill', { BACKUP_DIR: target });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /pg_restore/);
  assertCleaned(result.stdout);
});

test('SIGTERM after resource creation exits unsuccessfully and cleans up', async () => {
  const result = await run('restore-drill', {}, true);
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stdout, /^MATCH /m);
  assertCleaned(result.stdout);
});

test('missing backups and invalid metadata fail before allocating resources', async () => {
  const empty = join(directory, 'empty');
  await mkdir(empty);
  await writeFile(join(empty, 'rental-9999.dump.part'), 'unfinished');
  const missing = await run('restore-drill', { BACKUP_DIR: empty });
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /No completed/);
  assert.doesNotMatch(missing.stdout, /Resources:/);
  const target = await alteredBackup('invalid', async (_file, value) => {
    value.control.table = 'unexpected_table';
  });
  const invalid = await run('restore-drill', { BACKUP_DIR: target });
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /metadata/);
  assert.match(invalid.stderr, /control\.table/);
  assert.doesNotMatch(invalid.stdout, /Resources:/);
});

test('an unmigrated snapshot fails the drill instead of reporting MATCH', async () => {
  const name = `retro_restore_empty_${randomUUID().replaceAll('-', '')}`;
  const admin = process.env.DB_ADMIN_USER ?? 'db_admin';
  function adminSql(query) {
    return docker(
      'compose',
      'exec',
      '-T',
      'db',
      'psql',
      '-X',
      '-U',
      admin,
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      query,
    );
  }
  adminSql(`CREATE DATABASE ${name}`);
  try {
    const target = join(directory, 'unmigrated');
    const emptyUrl = new URL(url);
    emptyUrl.port = new URL(`http://${docker('compose', 'port', 'db', '5432')}`).port;
    emptyUrl.pathname = `/${name}`;
    const backup = await run('backup', { BACKUP_DIR: target, DATABASE_URL: emptyUrl.href });
    assert.equal(backup.code, 0, backup.stderr);
    const result = await run('restore-drill', { BACKUP_DIR: target });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /public\.game_copies.*absent/);
    assert.doesNotMatch(result.stdout, /^MATCH /m);
    assertCleaned(result.stdout);
  } finally {
    adminSql(`DROP DATABASE ${name}`);
  }
});
