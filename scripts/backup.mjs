import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function databaseUrl() {
  try {
    const url = new URL(process.env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    if (!url.hostname || url.pathname.length < 2) throw new Error();
    return url;
  } catch {
    throw new Error('Set DATABASE_URL to a PostgreSQL connection URL including the database name');
  }
}

function containerUrl(source) {
  const url = new URL(source);
  if (url.hostname === 'pgbouncer') {
    throw new Error('Set DATABASE_URL to a direct PostgreSQL endpoint, not PgBouncer');
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    // Both the exported snapshot and pg_dump must bypass the transaction pool.
    // Match only this project's direct PostgreSQL port; never guess a database.
    const port = Number(url.port || 5432);
    const published = execFileSync('docker', ['compose', 'port', 'db', '5432'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    }).trim();
    if (Number(new URL(`http://${published}`).port) !== port) {
      throw new Error("DATABASE_URL must use this Compose project's direct PostgreSQL port");
    }
    url.hostname = 'db';
    url.port = '5432';
  }
  return url;
}

async function dump(url, snapshot, filename) {
  const file = await open(filename, 'wx', 0o600);
  try {
    const target = new URL(url);
    const password = target.searchParams.get('password') ?? decodeURIComponent(target.password);
    target.password = '';
    target.searchParams.delete('password');
    // Pass credentials through the environment, never command arguments.
    const child = spawn(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        '-e',
        'PGPASSWORD',
        'db',
        'pg_dump',
        '--no-password',
        '--format=custom',
        '--lock-wait-timeout=10000',
        `--snapshot=${snapshot}`,
        `--dbname=${target.href}`,
      ],
      {
        cwd: root,
        env: { ...process.env, PGPASSWORD: password },
        stdio: ['ignore', file.fd, 'inherit'],
      },
    );
    const [code, signal] = await once(child, 'close');
    if (code !== 0) throw new Error(`pg_dump failed (${signal ?? code})`);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function main() {
  const url = databaseUrl();
  // Validate the direct endpoint before connecting or exporting a snapshot.
  const target = containerUrl(url);
  const directory = resolve(root, process.env.BACKUP_DIR || 'backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const date = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const filename = join(directory, `rental-${date}-${randomUUID()}.dump`);
  const partial = `${filename}.part`;
  const metadataFile = `${filename}.json`;
  const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  let published = false;
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {
      rows: [snapshot],
    } = await client.query('SELECT pg_export_snapshot() AS id');
    const {
      rows: [table],
    } = await client.query("SELECT to_regclass('public.game_copies') IS NOT NULL AS exists");
    let control = { rows: '0', sumPricePerDay: '0' };
    if (table.exists) {
      const result = await client.query(`SELECT count(*)::text AS rows,
        coalesce(sum(price_per_day), 0)::text AS "sumPricePerDay" FROM public.game_copies`);
      [control] = result.rows;
    }
    await dump(target, snapshot.id, partial);
    await client.query('COMMIT');
    await writeFile(
      metadataFile,
      `${JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          database: decodeURIComponent(url.pathname.slice(1)),
          control: { table: 'public.game_copies', exists: table.exists, ...control },
        },
        null,
        2,
      )}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    // Publishing the dump last is the completion marker: it always has metadata.
    await rename(partial, filename);
    published = true;
    console.log(filename);
  } finally {
    try {
      await client.end();
    } finally {
      if (!published) {
        await rm(partial, { force: true });
        await rm(metadataFile, { force: true });
      }
    }
  }
}

main().catch(error => {
  console.error(`Backup failed: ${error.message}`);
  process.exitCode = 1;
});
