import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../dist/database/data-source-options.js';

assert.match(process.env.COMPOSE_PROJECT_NAME ?? '', /^retro-hw15-test-[a-z0-9-]+$/);
let directory;
let url;
let db;
let expected;

function compose(...args) {
  return execFileSync('docker', ['compose', ...args], { encoding: 'utf8' }).trim();
}

async function backup(environment = {}) {
  const child = spawn('bash', ['scripts/with-secrets.sh', 'dev', 'bash', 'scripts/backup.sh'], {
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
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr += chunk;
  });
  const [code] = await once(child, 'close');
  return { code, stdout: stdout.trim(), stderr };
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'retro-backup-test-'));
  const port = new URL(`http://${compose('port', 'db', '5432')}`).port;
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
  const gameId = randomUUID();
  const platformId = randomUUID();
  await db.query(
    `INSERT INTO games (game_id, name, name_uk, description, description_uk)
    VALUES ($1, 'Backup test', 'Тест бекапу', '', '')`,
    [gameId],
  );
  await db.query(
    `INSERT INTO platforms (platform_id, name, description, description_uk, release_date)
    VALUES ($1, $2, '', '', '2000-01-01')`,
    [platformId, platformId],
  );
  for (const price of [2500, 4000]) {
    await db.query(
      `INSERT INTO game_copies
      (game_copy_id, game_id, platform_id, condition, format, price_per_day)
      VALUES ($1, $2, $3, 'good', 'cartridge', $4)`,
      [randomUUID(), gameId, platformId, price],
    );
  }
  [expected] = await db.query(`SELECT count(*)::text AS rows,
    coalesce(sum(price_per_day), 0)::text AS "sumPricePerDay" FROM game_copies`);
});

after(async () => {
  if (db?.isInitialized) await db.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('creates a dated custom archive and control values from its snapshot', async () => {
  const result = await backup();
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /rental-\d{4}-\d{2}-\d{2}T.*\.dump$/);
  const metadata = JSON.parse(await readFile(`${result.stdout}.json`, 'utf8'));
  assert.deepEqual(metadata.control, {
    table: 'public.game_copies',
    exists: true,
    ...expected,
  });
  const contents = execFileSync('docker', ['compose', 'exec', '-T', 'db', 'pg_restore', '--list'], {
    input: await readFile(result.stdout),
    encoding: 'utf8',
  });
  assert.match(contents, /TABLE DATA public game_copies/);
  assert.match(contents, /FUNCTION pgbouncer user_lookup/);
  const again = await backup();
  assert.equal(again.code, 0, again.stderr);
  assert.notEqual(again.stdout, result.stdout);
  assert.equal(
    (await readdir(directory)).some(name => name.endsWith('.part')),
    false,
  );
});

test('failed authentication publishes no archive and does not expose the password', async () => {
  const before = await readdir(directory);
  const invalid = new URL(url);
  invalid.password = 'wrong-backup-secret';
  const result = await backup({ DATABASE_URL: invalid.href });
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('wrong-backup-secret'), false);
  assert.deepEqual(await readdir(directory), before);
});

test('rejects the pooler endpoint before publishing a backup', async () => {
  const before = await readdir(directory);
  const pooled = new URL(url);
  pooled.port = new URL(`http://${compose('port', 'pgbouncer', '6432')}`).port;
  const result = await backup({ DATABASE_URL: pooled.href });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /direct PostgreSQL/);
  assert.equal(result.stdout, '');
  assert.deepEqual(await readdir(directory), before);
});

test('a fresh database without application tables is backed up with an explicit empty baseline', async () => {
  const name = `retro_backup_empty_${randomUUID().replaceAll('-', '')}`;
  const admin = process.env.DB_ADMIN_USER ?? 'db_admin';
  compose(
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
    `CREATE DATABASE ${name}`,
  );
  try {
    const emptyUrl = new URL(url);
    emptyUrl.port = new URL(`http://${compose('port', 'db', '5432')}`).port;
    emptyUrl.pathname = `/${name}`;
    const result = await backup({ DATABASE_URL: emptyUrl.href });
    assert.equal(result.code, 0, result.stderr);
    const metadata = JSON.parse(await readFile(`${result.stdout}.json`, 'utf8'));
    assert.deepEqual(metadata.control, {
      table: 'public.game_copies',
      exists: false,
      rows: '0',
      sumPricePerDay: '0',
    });
  } finally {
    compose(
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
      `DROP DATABASE ${name}`,
    );
  }
});

test('a Docker failure removes partial files and leaves completed backups untouched', async () => {
  const before = await readdir(directory);
  // Keep a valid SQL connection, but make the Docker command fail.
  const result = await backup({
    COMPOSE_PROJECT_NAME: `${process.env.COMPOSE_PROJECT_NAME}-missing`,
  });
  assert.notEqual(result.code, 0);
  assert.deepEqual(await readdir(directory), before);
});
