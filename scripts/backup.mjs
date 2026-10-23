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
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    // Host loopback means a different machine inside a container. Match the
    // published Compose port, then use that SAME service's internal address.
    const port = Number(url.port || 5432);
    let matched = false;
    for (const [service, internalPort] of [
      ['pgbouncer', 6432],
      ['db', 5432],
    ]) {
      try {
        const published = execFileSync(
          'docker',
          ['compose', 'port', service, String(internalPort)],
          {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 15000,
          },
        ).trim();
        if (Number(new URL(`http://${published}`).port) !== port) continue;
        url.hostname = service;
        url.port = String(internalPort);
        matched = true;
        break;
      } catch {
        // Try the other service; never fall back to an unrelated database.
      }
    }
    if (!matched) throw new Error('DATABASE_URL port does not match this Compose project');
  }
  return url;
}

async function dump(url, snapshot, filename) {
  const file = await open(filename, 'wx', 0o600);
  try {
    const target = containerUrl(url);
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
    await dump(url, snapshot.id, partial);
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
