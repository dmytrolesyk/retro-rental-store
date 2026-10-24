import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../dist/database/data-source-options.js';

// Rotation and RECONNECT affect the whole stack. Refuse ordinary project names.
assert.match(process.env.COMPOSE_PROJECT_NAME ?? '', /^retro-hw15-test-[a-z0-9-]+$/);

const appUser = process.env.DB_APP_USER ?? 'db_app';
const adminUser = process.env.DB_ADMIN_USER ?? 'db_admin';
const adminPassword = process.env.DB_ADMIN_PASSWORD ?? 'admin_dev';
let poolerAddress;
let databaseAddress;
let apiAddress;
let poolerAdmin;

function compose(...args) {
  return execFileSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    timeout: 15000,
  }).trim();
}

function publishedAddress(service, port) {
  const address = new URL(`http://${compose('port', service, String(port))}`);
  return { host: address.hostname, port: Number(address.port) };
}

function readCredential(name) {
  // The value stays in test-process memory; never put it in command arguments or logs.
  return compose('exec', '-T', 'db', 'cat', `/run/secrets/${name}`);
}

function appConnection(password = readCredential('db_app_password')) {
  return { ...poolerAddress, user: appUser, database: 'rental', password };
}

function createClient(connection) {
  return new pg.Client({ connectionTimeoutMillis: 3000, query_timeout: 10000, ...connection });
}

async function withClient(connection, run) {
  const client = createClient(connection);
  try {
    await client.connect();
    return await run(client);
  } finally {
    await client.end();
  }
}

async function withAppDataSource(run) {
  const connection = appConnection();
  // Use the application's options factory, with host-side connection settings.
  const db = new DataSource(
    createDataSourceOptions({
      DB_HOST: connection.host,
      DB_PORT: connection.port,
      DB_USER: connection.user,
      DB_NAME: connection.database,
      DB_PASSWORD: connection.password,
    }),
  );
  try {
    await db.initialize();
    return await run(db);
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}

async function waitForWaitingClient() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await poolerAdmin.query('SHOW POOLS');
    const pool = rows.find(row => row.database === 'rental' && row.user === appUser);
    if (Number(pool?.cl_waiting) >= 1) return;
    await delay(25);
  }
  assert.fail('PgBouncer did not report a waiting client within 5 seconds');
}

function containerState(service) {
  const id = compose('ps', '-q', service);
  const state = execFileSync(
    'docker',
    ['inspect', '--format', '{{.State.StartedAt}} {{.RestartCount}}', id],
    { encoding: 'utf8', timeout: 15000 },
  ).trim();
  return { id, state };
}

before(async () => {
  poolerAddress = publishedAddress('pgbouncer', 6432);
  databaseAddress = publishedAddress('db', 5432);
  apiAddress = publishedAddress('node', Number(process.env.PORT ?? 3000));
  poolerAdmin = createClient({
    ...poolerAddress,
    user: 'pgbouncer_admin',
    database: 'pgbouncer',
    password: adminPassword,
  });
  await poolerAdmin.connect();
});

after(async () => {
  if (poolerAdmin) await poolerAdmin.end();
});

async function assertApiQuery() {
  const response = await fetch(`http://${apiAddress.host}:${apiAddress.port}/db`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dbQuery.current_user, appUser);

  const apiContainer = compose('ps', '-q', 'node');
  const apiIp = execFileSync(
    'docker',
    [
      'inspect',
      '--format',
      '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
      apiContainer,
    ],
    { encoding: 'utf8', timeout: 15000 },
  ).trim();
  const clients = await poolerAdmin.query('SHOW CLIENTS');
  assert.ok(
    clients.rows.some(
      row => row.database === 'rental' && row.user === appUser && row.addr === apiIp,
    ),
    'The actual Nest container must have a client connection to PgBouncer',
  );
  return clients.rows.filter(row => row.database === 'rental' && row.addr === apiIp);
}

test('API and TypeORM transactions use the transaction pool', async () => {
  await assertApiQuery();
  await withAppDataSource(db =>
    db.transaction(async manager => {
      const [first] = await manager.query('SELECT pg_backend_pid() AS pid');
      const [second] = await manager.query('SELECT pg_backend_pid() AS pid, current_user AS name');
      assert.equal(first.pid, second.pid);
      assert.equal(second.name, appUser);
    }),
  );

  const pools = await poolerAdmin.query('SHOW POOLS');
  const appPool = pools.rows.find(row => row.database === 'rental' && row.user === appUser);
  assert.equal(appPool?.pool_mode, 'transaction');
  const config = await poolerAdmin.query('SHOW CONFIG');
  assert.equal(config.rows.find(row => row.key === 'default_pool_size')?.value, '5');
  assert.equal(config.rows.find(row => row.key === 'max_client_conn')?.value, '100');
});

test('auth role can look up app credentials but cannot read admin credentials or tables', async () => {
  const table = `pooler_access_${randomUUID().replaceAll('-', '')}`;
  await withClient(
    {
      ...databaseAddress,
      user: adminUser,
      database: 'rental',
      password: adminPassword,
    },
    async admin => {
      await admin.query(`CREATE TABLE public.${table} (id integer)`);
      try {
        await withClient(
          {
            ...databaseAddress,
            user: 'db_pool_auth',
            database: 'rental',
            password: readCredential('db_pool_auth_password'),
          },
          async auth => {
            const app = await auth.query('SELECT username FROM pgbouncer.user_lookup($1)', [
              appUser,
            ]);
            assert.equal(app.rows[0]?.username, appUser);
            const forbidden = await auth.query('SELECT username FROM pgbouncer.user_lookup($1)', [
              adminUser,
            ]);
            assert.equal(forbidden.rowCount, 0);
            await assert.rejects(auth.query('SELECT rolname FROM pg_catalog.pg_authid'), {
              code: '42501',
            });
            await assert.rejects(auth.query(`SELECT * FROM public.${table}`), { code: '42501' });

            // Effective privileges include membership and PUBLIC grants, not just direct grants.
            const access = await auth.query(`
          SELECT EXISTS (
            SELECT FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
              AND has_table_privilege(current_user, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
          ) AS allowed
        `);
            assert.equal(access.rows[0].allowed, false);
          },
        );
      } finally {
        await admin.query(`DROP TABLE public.${table}`);
      }
    },
  );
});

test('six clients share five backends and the sixth transaction queues', async () => {
  const connection = appConnection();
  const clients = Array.from({ length: 6 }, () => createClient(connection));
  try {
    await Promise.all(clients.map(client => client.connect()));
    const pids = [];
    for (const client of clients.slice(0, 5)) {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
      pids.push(rows[0].pid);
    }
    assert.equal(new Set(pids).size, 5);
    let sixthError;
    const sixth = clients[5].query('BEGIN').catch(error => {
      sixthError = error;
    });
    await waitForWaitingClient();
    await clients[0].query('COMMIT');
    await sixth;
    if (sixthError) throw sixthError;
    const { rows } = await clients[5].query('SELECT pg_backend_pid() AS pid');
    assert.equal(rows[0].pid, pids[0], 'The released backend is reused');
    await Promise.all(clients.slice(1).map(client => client.query('COMMIT')));
  } finally {
    await Promise.all(clients.map(client => client.end()));
  }
});

test('rotation preserves a transaction, rejects the old password and authenticates new backends', async () => {
  const poolerBefore = containerState('pgbouncer');
  const apiBefore = containerState('node');
  const apiClients = await assertApiQuery();
  const oldConnection = appConnection();
  await withClient(oldConnection, async active => {
    await active.query('BEGIN');
    const first = await active.query('SELECT pg_backend_pid() AS pid');
    compose('exec', '-T', 'rotator', '/usr/local/bin/rotate-loop.sh', '--once');
    const second = await active.query('SELECT pg_backend_pid() AS pid');
    assert.equal(first.rows[0].pid, second.rows[0].pid);
    await active.query('COMMIT');
  });
  await assert.rejects(
    withClient(oldConnection, client => client.query('SELECT 1')),
    error => error.code === '08P01' && error.message === 'SASL authentication failed',
  );

  // Retire existing backends so a working old session cannot mask a broken login.
  await poolerAdmin.query('RECONNECT rental');
  await poolerAdmin.query('WAIT_CLOSE rental');
  // Force the running Nest process to reread its file on a new client connection.
  const currentClients = await poolerAdmin.query('SHOW CLIENTS');
  const oldIds = new Set(apiClients.map(client => String(client.id)));
  for (const client of currentClients.rows.filter(row => oldIds.has(String(row.id)))) {
    const id = String(client.id);
    assert.match(id, /^\d+$/);
    await poolerAdmin.query(`KILL_CLIENT ${id}`);
  }
  await assertApiQuery();
  await withAppDataSource(async db => {
    const [row] = await db.query('SELECT 1 AS value');
    assert.equal(row.value, 1);
  });
  assert.deepEqual(containerState('pgbouncer'), poolerBefore);
  assert.deepEqual(containerState('node'), apiBefore);
});
