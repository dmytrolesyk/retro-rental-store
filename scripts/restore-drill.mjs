import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { open, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);

const integerStringSchema = z.string().regex(/^\d+$/, 'Expected a non-negative integer string');
const metadataSchema = z.object({
  version: z.literal(1),
  database: z.string().min(1),
  createdAt: z.iso.datetime(),
  control: z
    .object({
      table: z.literal('public.game_copies'),
      exists: z.boolean(),
      rows: integerStringSchema,
      sumPricePerDay: integerStringSchema,
    })
    .refine(control => control.exists || (control.rows === '0' && control.sumPricePerDay === '0'), {
      message: 'An absent table must have zero rows and zero sumPricePerDay',
    }),
});

async function latestBackup() {
  const directory = resolve(root, process.env.BACKUP_DIR || 'backups');
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  // backup.mjs names archives with UTC timestamps; lexicographic order is time order.
  // Only a published .dump counts. Orphaned JSON and .part files are ignored.
  const names = entries
    .filter(entry => entry.isFile() && /^rental-\d{4}-\d{2}-\d{2}T.*\.dump$/.test(entry.name))
    .map(entry => entry.name)
    .sort();
  if (!names.length) throw new Error(`No completed backups in ${directory}`);
  const filename = join(directory, names.at(-1));
  const result = metadataSchema.safeParse(JSON.parse(await readFile(`${filename}.json`, 'utf8')));
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid backup metadata:\n${issues}`);
  }
  return { filename, metadata: result.data };
}

async function main() {
  const { filename, metadata } = await latestBackup();
  const archive = await open(filename, 'r');
  const id = randomUUID();
  const container = `retro-restore-${id}`;
  const volume = `${container}-data`;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Restore-drill interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let volumeCreated = false;
  let containerCreated = false;
  let actual;
  let restoreSeconds;
  let rtoSeconds;
  let failure;
  const cleanupFailures = [];

  async function docker(args, options = {}) {
    const { stdout } = await execute('docker', args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
      signal: controller.signal,
      ...options,
    });
    return stdout.trim();
  }

  function sql(query) {
    return docker([
      'exec',
      container,
      'psql',
      '-X',
      '-h',
      '127.0.0.1',
      '-U',
      'postgres',
      '-d',
      'drill',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-c',
      query,
    ]);
  }

  const started = performance.now();
  try {
    console.log(`Archive: ${filename} (${(await archive.stat()).size} bytes)`);
    controller.signal.throwIfAborted();
    // Finish allocation even if interrupted, so cleanup knows exactly what was created.
    await docker(['volume', 'create', '--label', `retro.restore-drill=${id}`, volume], {
      signal: undefined,
    });
    volumeCreated = true;
    controller.signal.throwIfAborted();
    await docker(
      [
        'create',
        '--name',
        container,
        '--label',
        `retro.restore-drill=${id}`,
        '--network',
        'none',
        '--mount',
        `type=volume,source=${volume},target=/var/lib/postgresql`,
        '--env',
        'POSTGRES_PASSWORD',
        '--env',
        'POSTGRES_DB=drill',
        'postgres:18',
      ],
      { signal: undefined, env: { ...process.env, POSTGRES_PASSWORD: randomUUID() } },
    );
    containerCreated = true;
    console.log(`Resources: ${container} ${volume}`);
    await docker(['start', container]);
    const deadline = performance.now() + 60000;
    while (true) {
      try {
        // TCP avoids treating the entrypoint's temporary initialization server as ready.
        await docker([
          'exec',
          container,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'postgres',
          '-d',
          'drill',
        ]);
        break;
      } catch (error) {
        controller.signal.throwIfAborted();
        if (performance.now() >= deadline)
          throw new Error('Restore PostgreSQL was not ready within 60 seconds', { cause: error });
        await setTimeout(250, undefined, { signal: controller.signal });
      }
    }
    const tables = await sql(`SELECT count(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r', 'p')`);
    if (tables !== '0') throw new Error('Restore target is not empty');

    const restoreStarted = performance.now();
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        container,
        'pg_restore',
        '-U',
        'postgres',
        '-d',
        'drill',
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        '--single-transaction',
      ],
      {
        cwd: root,
        signal: controller.signal,
        stdio: [archive.fd, 'inherit', 'inherit'],
      },
    );
    const [code, signal] = await once(child, 'close');
    if (code !== 0) throw new Error(`pg_restore failed (${signal ?? code})`);
    restoreSeconds = (performance.now() - restoreStarted) / 1000;

    const exists = await sql("SELECT to_regclass('public.game_copies') IS NOT NULL");
    if (exists !== 't') {
      throw new Error(
        'Required application table public.game_copies is absent in the restored database',
      );
    }
    actual = { exists: exists === 't', rows: '0', sumPricePerDay: '0' };
    if (actual.exists) {
      const values = JSON.parse(
        await sql(`SELECT json_build_object(
        'rows', count(*)::text, 'sumPricePerDay', coalesce(sum(price_per_day), 0)::text)
        FROM public.game_copies`),
      );
      Object.assign(actual, values);
    }
    const expected = metadata.control;
    if (['exists', 'rows', 'sumPricePerDay'].some(key => actual[key] !== expected[key])) {
      throw new Error(
        `MISMATCH: expected ${JSON.stringify(expected)}, restored ${JSON.stringify(actual)}`,
      );
    }
    rtoSeconds = (performance.now() - started) / 1000;
  } catch (error) {
    failure = error;
  } finally {
    // Cleanup deliberately ignores the abort signal and addresses only this run's names.
    for (const args of [
      ...(containerCreated ? [['rm', '--force', container]] : []),
      ...(volumeCreated ? [['volume', 'rm', volume]] : []),
    ]) {
      try {
        await docker(args, { signal: undefined });
      } catch (error) {
        cleanupFailures.push(error.message);
      }
    }
    try {
      await archive.close();
    } catch (error) {
      cleanupFailures.push(error.message);
    }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  if (failure || cleanupFailures.length) {
    throw new Error(
      [
        ...(failure ? [failure.message] : []),
        ...(cleanupFailures.length ? [`Cleanup failed: ${cleanupFailures.join('\n')}`] : []),
      ].join('\n'),
    );
  }
  controller.signal.throwIfAborted();
  console.log(
    `MATCH exists=${actual.exists} rows=${actual.rows} sumPricePerDay=${actual.sumPricePerDay}`,
  );
  console.log(`pg_restore: ${restoreSeconds.toFixed(3)} seconds`);
  console.log(`RTO (create through verification): ${rtoSeconds.toFixed(3)} seconds`);
  console.log(
    'RPO: up to about 24 hours with successful nightly backups; missed runs increase this window.',
  );
}

main().catch(error => {
  console.error(`Restore-drill failed: ${error.message}`);
  process.exitCode = 1;
});
