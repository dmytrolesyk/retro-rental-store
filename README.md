# Retro games rental

Node.js / NestJS course project: a retro game rental catalog backed by
PostgreSQL 18 and TypeORM. Homework 13 adds entities, explicit relations,
migrations, a repeatable offline seed, an N+1 demonstration and a platform
popularity report.

## Development setup and build

Use the pnpm version declared in `package.json` and the committed lockfile:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run build
```

`nest build` uses the TypeScript compiler (`tsc`) and writes the application
entry point to `dist/main.js`. `experimentalDecorators` and
`emitDecoratorMetadata` are enabled for Nest and TypeORM decorators.
TypeORM and `@nestjs/typeorm` are runtime dependencies; `pg` provides the
PostgreSQL driver and `reflect-metadata` provides runtime metadata support.

## Configuration

Connection settings are validated by `src/config/database-env.schema.ts`.
Nest adds HTTP settings via `src/config/env.schema.ts`; the CLI needs only DB
settings. Both paths read `process.env`, without loading a `.env` file.
For host-side development, export the variables in your shell.

| Variable | Required | Description |
| --- | --- | --- |
| `DB_HOST` | yes | `pgbouncer` inside Compose, `127.0.0.1` from the host |
| `DB_PORT` | no, default `5432` | Process connection port; set `6432` for PgBouncer |
| `DB_USER` | yes | User for this process's connection |
| `DB_NAME` | yes | Database name |
| `DB_PASSWORD` | one password source | Static password for CLI commands |
| `DB_PASSWORD_FILE` | one password source | Rotatable password file for the API |
| `PORT` | API only | HTTP port |
| `LOG_LEVEL` | no, default `info` | `debug`, `info`, `warn`, `error` |
| `TIMEOUT_MS` | no, default `5000` | Generic operation timeout in milliseconds |

Set exactly one of `DB_PASSWORD` and `DB_PASSWORD_FILE`.
`.env.example` documents the API connection and role-specific Compose settings;
`pnpm check:env` validates it. It is not loaded by Nest or the TypeORM CLI.
Compose can read a local `.env` for its own interpolation.

Compose provisioning uses `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD`,
`DB_MIGRATION_USER` / `DB_MIGRATION_PASSWORD`, and
`DB_APP_USER` / `DB_APP_PASSWORD_FILE`. These describe each role;
`DB_USER` and the password source describe the connection of one process.
The image's `POSTGRES_PASSWORD` and psql's `PGPASSWORD` both receive the admin
password, under the names required by those tools.

### Running

Start PostgreSQL, PgBouncer, the API and the automatic password rotator:

```bash
docker compose up -d --wait
```

No `.env` or host-side secret files are required. The one-shot `init-secrets`
service generates the `db_app` password in the `app_credentials` named
volume before PostgreSQL starts. Existing passwords are kept on subsequent
runs. It also generates a separate `db_pool_auth_password` for PgBouncer's
authentication lookup. PostgreSQL, PgBouncer, the auth setup service and the API
mount this volume read-only; the init service and rotator can write to it.

To explicitly rebuild images and start the stack:

```bash
pnpm compose:up   # docker compose up -d --build --wait
pnpm compose:down
```

The API uses `pgbouncer:6432` inside Compose. Host-side scripts use `127.0.0.1`
and `DB_PORT=6432`. Compose publishes PgBouncer on `PGBOUNCER_PORT` (default
`6432`) and direct PostgreSQL on `POSTGRES_PORT` (default `5432`), both on
loopback. These host port overrides are independent of the process's `DB_PORT`.
Compose supplies the API's `DB_*` configuration directly; no profile is required.

This homework uses the new `data_typeorm` database volume. The previous
homework's `data_sql` volume is retained. Keep `data_typeorm` and
`app_credentials` together: deleting only the credentials volume generates
a password that no longer matches the existing database role.

### Database roles

| Role | Purpose | Credentials |
| ---- | ------- | ----------- |
| `db_admin` | Local database initialization and password rotation | Dev password `admin_dev` |
| `db_migrator` | Host-side migrations, seed, demos and reports | Dev password `migration_dev` |
| `db_app` | API queries; no schema creation privileges | Generated password, rotated automatically |
| `db_pool_auth` | PgBouncer password lookup function only | Generated password in the credentials volume |
| `db_pool_client` | No-login group allowing authentication lookup for API/CLI roles | No password |

`db_migrator` can create objects in `public` and install trusted
extensions in the development database. Default privileges give `db_app`
SELECT/INSERT/UPDATE/DELETE on tables and USAGE/SELECT on sequences created
by `db_migrator`. Docker initialization creates roles and grants only;
application tables will be created by TypeORM migrations.

### Data layer ops: PgBouncer (homework 15)

`pgbouncer/pgbouncer.ini` uses transaction pooling: a PostgreSQL connection is
assigned until COMMIT/ROLLBACK, then shared with another client. This lets
long-lived TypeORM pools share fewer server connections. The limit is 5 per
database/user pair, with at most 100 incoming clients across the pooler. A client
cannot rely on the same server session between transactions: `LISTEN`,
session advisory locks and `WITH HOLD` cursors are incompatible. `NOTIFY` works.
Protocol-level named prepared statements are tracked with
`max_prepared_statements=200`; SQL `PREPARE` across transactions is unsupported.
See the [PgBouncer feature map](https://www.pgbouncer.org/features.html).

`pooler-auth` installs an idempotent `SECURITY DEFINER` lookup function into the
existing database as well as fresh databases. Only `db_pool_auth` can call it;
it returns SCRAM verifiers only for non-superuser login roles in `db_pool_client`
(the app and migrator). Expired credentials are rejected. The lookup role cannot
read `pg_authid` directly or access application tables. A pinned search path
prevents object substitution. The pooler preserves the requested database role;
there is no forced `user=` in its database mapping.

Only the lookup credential and `pgbouncer_admin` console credential are written
to a mode-600 runtime auth file. Application verifiers come from `auth_query` on
new client authentication, so rotating `db_app` does not require copying its
password into PgBouncer or reloading the pooler. The console reuses the existing
Compose `DB_ADMIN_PASSWORD` (local default `admin_dev`); `pgbouncer_admin` is a
pooler console identity, not a PostgreSQL administrator role. The generated lookup
password is an additional internal credential kept in the existing named volume,
not a new env file. See [authentication configuration](https://www.pgbouncer.org/config.html#auth_query).

Check the published port from the host (with a local `psql` installed):

```bash
PGPASSWORD=migration_dev psql -h 127.0.0.1 -p "${PGBOUNCER_PORT:-6432}" -U db_migrator -d rental -c 'SELECT 1'
PGPASSWORD=admin_dev psql -h 127.0.0.1 -p "${PGBOUNCER_PORT:-6432}" -U pgbouncer_admin -d pgbouncer -c 'SHOW POOLS'
curl "http://127.0.0.1:${PORT:-3000}/db"
```

Without host `psql`, the container includes it:

```bash
docker compose exec -T -e PGPASSWORD=migration_dev pgbouncer psql -h 127.0.0.1 -p 6432 -U db_migrator -d rental -c 'SELECT 1'
docker compose exec -T pgbouncer psql -h 127.0.0.1 -p 6432 -U pgbouncer_admin -d pgbouncer -c 'SHOW POOLS'
```

When using Infisical, update the existing `DB_HOST`/`DB_PORT` values in both
`dev` and `prod` to that environment's pooler address. A host-side client uses
`127.0.0.1` and the published port locally; a Compose client uses `pgbouncer:6432`.
For URL consumers the corresponding `DATABASE_URL` must use the same endpoint.
`.env.example` documents the URL with a deliberately fake password; the API and
current TypeORM CLI continue to consume the validated `DB_*` fields. Secret-store
updates must be performed in the actual environments; editing this file does
not change them. Physical backup/PITR remains an optional subsequent homework step.

### Logical backup and nightly schedule (homework 15)

Run from the repository root with Node 24, installed project dependencies, Docker
and this Compose stack running. Host PostgreSQL binaries are not required:
`scripts/backup.sh` runs the Node helper `scripts/backup.mjs`, which uses the
PostgreSQL 18 `pg_dump` already installed in the `db` container.

```bash
export DATABASE_URL="postgresql://db_migrator:migration_dev@127.0.0.1:${POSTGRES_PORT:-5432}/rental"
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh
```

With Infisical configured, omit `SKIP_VAULT` and store the existing connection URL
in the selected environment. The script reads `DATABASE_URL` directly; it does
not load or create an env file. Use a role that can read every table being backed
up (the local `db_migrator` owns the application schema); the API role is not
granted additional permissions. On the host, the URL must be reachable from the
host. Use a direct PostgreSQL endpoint for backups: the snapshot connection
and pg_dump must both bypass PgBouncer. For loopback URLs the helper requires
the published `db` port and uses `db:5432` for the container-side dump. Pooler
and unmatched loopback endpoints are rejected before opening a SQL connection.
Non-loopback URLs must identify PostgreSQL directly and be reachable from both
the host and the `db` container.

Success prints one absolute archive path, for example
`backups/rental-2026-10-23T12-00-00-000Z-<uuid>.dump` under the project directory.
Times are UTC; UUIDs allow multiple backups in the same second. Set `BACKUP_DIR`
to use another directory (relative paths are resolved from the project root).
The default `backups/` is excluded from Git and Docker builds. Files are created
with mode 600. A `.part` archive is renamed to `.dump` only after the dump and
its adjacent `.dump.json` metadata are ready; failed runs do not publish it.

The JSON records `count(*)` and `sum(price_per_day)` for `public.game_copies`.
Both the queries and `pg_dump --snapshot` use one exported, read-only
REPEATABLE READ snapshot. The exporting transaction stays open until the dump
finishes, so concurrent writes cannot make the saved control values disagree
with the archived snapshot. This adapts the lecturer's
`code/15_PoolingReplicasSharding/scripts/08-backup-drill.sh` while avoiding a
later comparison against an already changed live database. Preserve the dump
and JSON together for restore-drill. If migrations have not run,
the backup honestly records `exists=false` and zero control values; apply the
Grading migrations and seed first to back up a populated application database.

Inspect a completed archive without installing host `pg_restore`:

```bash
# Replace the example path with the path printed by backup.sh.
docker compose exec -T db pg_restore --list < backups/<archive>.dump
```

This checks the archive's table of contents; use the restore-drill below to
verify recovery. `pg_dump` does not save cluster-wide role definitions
or later changes, and does not provide WAL/PITR. With successful nightly backups
the nominal data-loss window is up to about 24 hours; failures can make it longer.
A local directory survives container replacement but shares the host's fate.

`backup.cron` contains a user-crontab job for 03:00 in the cron host's timezone.
It is a checked-in schedule, not an installed scheduler. To enable it, merge the
job and its environment settings into `crontab -e` (preserve existing jobs).
Replace the explicit `PROJECT_DIR` placeholder with the checkout's absolute path
and adjust PATH to include Node 24 and Docker. The template supplies
`SKIP_VAULT=1` and a direct `DATABASE_URL` using public local Compose defaults;
adjust the port, credentials and `COMPOSE_PROJECT_NAME` for your stack.
For vault mode set `SKIP_VAULT=0`, remove the template DATABASE_URL, include
Infisical in PATH and configure unattended vault access for the cron user.
Keep real credentials in the private crontab/vault, outside Git.
Cron does not inherit exports from an interactive terminal. With
Rancher Desktop, supply its Docker context or socket in that environment too.
Logs go to `/tmp/retro-games-rental-backup.log`. The schedule is not installed
automatically by the backup script.

### Restore-drill (homework 15)

With an existing backup, run:

```bash
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Use the same `SKIP_VAULT=1` fallback shown above for local/grading runs.
`scripts/restore-drill.sh` launches `scripts/restore-drill.mjs`. It selects the
latest completed `rental-<UTC timestamp>-<uuid>.dump` by filename in `BACKUP_DIR`
(default `backups/`) and reads its adjacent `.dump.json`. Partial archives and
orphaned JSON are ignored. Missing/invalid metadata or a damaged newest archive
fail the drill; the script does not silently fall back to an older backup.

Each run creates a uniquely named Docker volume and a plain `postgres:18`
container, with no published ports and networking disabled. It waits for the
final PostgreSQL server to accept connections and checks that the target has
no application tables. The dump is streamed from the host into
`pg_restore --no-owner --no-acl --exit-on-error --single-transaction`.
The [PostgreSQL options](https://www.postgresql.org/docs/18/app-pgrestore.html)
allow restoration without the source roles and fail on the first SQL error.
This checks schema/data recovery; it does not reproduce production owners,
grants, role passwords, or the application's complete recovery procedure.

The helper compares table presence, `count(*)` and `sum(price_per_day)` for
`public.game_copies` with the saved snapshot values. It never connects to the
live database, so changes after the backup do not affect this comparison and
the source database can be offline. `DATABASE_URL` is required for backup;
restore uses the local archive and its own newly created target instead.
As in the lecturer's `08-backup-drill.sh`, count and sum are a limited integrity
check, not proof that every field in every table is identical. If the restored
`public.game_copies` table is absent, the drill fails with a nonzero exit code
and never prints MATCH, even when the snapshot metadata also says exists=false.
A migrated but empty table is valid: its actual count and sum must still match.

Success prints `MATCH` with the restored control values, archive size, the
duration of the restore command, and measured drill RTO in seconds. The RTO
interval covers volume/container creation, readiness, restore and verification;
archive selection and cleanup are outside that interval. It is a local database
drill measurement, excluding incident detection, traffic switching and API startup.
RPO is nominally up to about 24 hours with successful nightly backups.

The container and volume are removed before printing `MATCH`, including on
restore/check failures and SIGINT/SIGTERM. Cleanup addresses only this run's
resource names, which are printed as `Resources: <container> <volume>`.
Cleanup failure is an error. An uncatchable kill or unavailable Docker daemon
can leave these resources for manual removal by their printed names.

The measured run on the seeded catalog is recorded in
[RESTORE-DRILL.md](RESTORE-DRILL.md): a 1,935,085-byte archive, two `MATCH` results,
and local drill RTO of 3.017 / 2.991 seconds. These are observations for that
dataset and machine, not an application availability guarantee.

Backup and restore checks use a fresh dedicated Compose project:

```bash
export COMPOSE_PROJECT_NAME=retro-hw15-test-backup
export POSTGRES_PORT=55451 PGBOUNCER_PORT=56451 PORT=33015
docker compose up -d --build --wait
pnpm run test:db:backup
pnpm run test:db:restore
docker compose down --volumes  # only this disposable test project
```

To run the pooler integration checks, use a dedicated disposable stack. These
checks rotate its app password and reconnect its backend sessions. Install the
project dependencies on the host first. The test command builds the local
TypeORM code, then tests connect from the host using `pg`, TypeORM and HTTP.
Published ports are discovered from Compose. Docker commands are used only for
credentials, rotation and container inspection; JavaScript is not executed from
strings inside the containers. The tests observe PgBouncer's waiting-client
count, check effective database privileges and verify the pooler's start time
and restart count across rotation:

```bash
export COMPOSE_PROJECT_NAME=retro-hw15-test-pooler
export POSTGRES_PORT=55451 PGBOUNCER_PORT=56451 PORT=33015
docker compose up -d --build --wait
pnpm run test:db:pooler
# Remove only this disposable stack:
docker compose down --volumes
```

### Password rotation (no API restart)

The API's TypeORM DataSource uses `pg` underneath and re-reads
`DB_PASSWORD_FILE` when opening a new connection. The rotator changes the
`db_app` password and atomically replaces the file. Existing sessions are
retained, so rotation does not forcibly interrupt their transactions.
Migration and admin passwords are unchanged.

```bash
./scripts/rotate.sh
```

Scheduled and manual rotations share a file lock. The automatic interval is
`ROTATE_INTERVAL` seconds (default `86400`):

```bash
ROTATE_INTERVAL=60 pnpm compose:up
```

Connections have a maximum lifetime of 300 seconds. A busy connection is
retired only after the application releases it; idle connections are retired
without interrupting queries. An open QueryRunner must always be released.

For file-based credentials, `RotationPool` retries only connection acquisition
on PostgreSQL authentication error `28P01` or PgBouncer's specific SCRAM failure
(`08P01`, `SASL authentication failed`): four attempts total, with waits
of 100, 200, and 400 milliseconds. SQL queries and transactions are never
replayed. This handles a short gap between changing the password and publishing
the file, but cannot guarantee availability if publication is delayed longer.
A crash between those operations still requires credential recovery.

### TypeORM CLI

Build first; the CLI loads `dist/data-source.js`, without bootstrapping Nest:

```bash
pnpm run build
pnpm run migrate:show
pnpm run migrate
pnpm run migrate:revert
# After changing entities, generate against a database with all existing migrations applied:
pnpm run migration:generate src/migrations/DescribeChange
pnpm run build # compile the generated migration before running it
```

Export the CLI credentials from the Grading block before these commands.
`synchronize: false` and `migrationsRun: false` prevent schema changes on API
startup. All nine entities and the initial migration are registered.
`migrate:show` marks the applied migration with `[X]`. Only the CLI module exports a
DataSource instance; both CLI and Nest use the same options factory.

### Existing volumes after the role rename

The new defaults are `db_admin`, `db_migrator`, and `db_app`, with the application
password in `db_app_password`. Initialization scripts run only on an empty
PostgreSQL volume. Existing volumes created with the old names are not upgraded
by changing Compose. Keep them intact; use a separate Compose project for a
fresh homework database, for example `docker compose -p retro-hw13 up -d --wait`
(with available `POSTGRES_PORT`, `PGBOUNCER_PORT` and `PORT`). Use the same
project name for subsequent commands.
Old role names can be retained through the role-specific Compose overrides,
but an old credentials volume also needs its password file migrated explicitly.

## Grading

Homework 15 requires Node.js 24, pnpm 10.24.0 and Docker with Compose v2
supporting `--wait`. Run from the repository root. No access to Infisical,
local env file or host PostgreSQL binaries is required for grading.
Install the checked-in dependencies, then run the startup → backup → drill
sequence using the existing local development credentials. Apply migrations
and seed before taking the application-data backup:

```bash
pnpm install --frozen-lockfile
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT="${PGBOUNCER_PORT:-6432}" DB_USER=db_migrator DB_PASSWORD=migration_dev DB_NAME=rental
unset DB_PASSWORD_FILE
pnpm run build
pnpm run migrate
pnpm run seed
export DATABASE_URL="postgresql://db_migrator:migration_dev@127.0.0.1:${POSTGRES_PORT:-5432}/rental"
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Both helpers read their settings from the process environment; neither loads an
env file. `with-secrets.sh` skips Infisical when `SKIP_VAULT=1`. Without that flag,
the configured Infisical environment supplies the backup's `DATABASE_URL`.
Restore reads local backup files and creates its own target, without connecting
to the source database.

A backup of an unmigrated database remains possible for diagnostics, but
restore-drill rejects it. After applying migrations, create a new backup rather
than reusing an older archive. Run the drill a second time to verify repeatability:

```bash
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Both restores must print `MATCH exists=true rows=10 sumPricePerDay=36250` for
a fresh seeded database. See [RESTORE-DRILL.md](RESTORE-DRILL.md) for the actual
clean-export run, recovery measurements, RPO assumptions and scope of the checks.
`backup.cron` is checked in but must be installed separately; it does not start
nightly backups just by being present in the repository.

For full-repository `eslint .`, also install the standalone LMS tool's own
dependencies with `pnpm --dir tools/lms-client install --frozen-lockfile`.
They are not needed to start the application or run backup/restore.

Prerequisites: Node.js 24, pnpm 10.24.0 (as declared in `package.json`), and
Docker with Compose v2 supporting `--wait`. Run from the repository root
against a fresh database. The three homework 14 demos use
`scripts/with-secrets.sh`. For grading and local runs without Infisical, set
`SKIP_VAULT=1` and provide the existing `DB_*` settings. The commands below use
the fixed public local development credentials from `compose.yaml`.

The longer homework 13/14 regression sequence below uses a separate disposable
project and includes migration rollback and transaction demos. Run it separately
from the homework 15 recovery measurement:

```bash
export COMPOSE_PROJECT_NAME=retro-hw14-grading
export SKIP_VAULT=1
export DB_HOST=127.0.0.1 DB_PORT="${PGBOUNCER_PORT:-6432}" DB_USER=db_migrator DB_PASSWORD=migration_dev DB_NAME=rental
unset DB_PASSWORD_FILE
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
docker compose up -d --wait
pnpm run build
pnpm run migrate
pnpm run migrate:show
pnpm run migrate:revert
pnpm run migrate
pnpm run migrate:show
pnpm run seed
pnpm run seed
pnpm run demo:nplus1
pnpm run report
pnpm run demo:race
pnpm run demo:workers
pnpm run demo:retry
```

PgBouncer is published on `6432`; if occupied, run `export PGBOUNCER_PORT=56441`
before this block. Override `POSTGRES_PORT` separately if direct port `5432` is
occupied, and `PORT` if HTTP port `3000` is occupied.
The block uses the separate Compose project `retro-hw14-grading`.
Choose a new project name if it already has a database volume from a previous
run. Compose uses that name for every command, including count checks.
No repository files need editing, and no host credential files need creating. `unset DB_PASSWORD_FILE` selects the CLI's static password source.

Both `migrate:show` calls must mark all migrations `[X]` (with their
journal IDs). There are three migrations. Revert rolls back only the latest,
`AddJobEmailRecipient1792051200001`: it removes `email_to` and preserves the
queue, balances and rentals. Reverting the preceding
`AddRentalBalanceAndJobs1792051200000` removes the queue and renter balances.
Reverting the initial migration removes business data. Run rollback checks only against a disposable database.

Use the count command in [ORM seed](#orm-seed) after each seed run: all nine
counts must stay unchanged. The fresh-database totals are 19,896 games,
19 platforms, 16 genres, 21,441 game/platform links, 154 game/genre links,
10 copies, 10 renters, 10 rentals and 20 items.
The N+1 summaries must be `26 → 1` for N=5 and `51 → 1` for N=10; the
paginated JOIN uses two queries for both. The report must match the table in
[Platform popularity report](#platform-popularity-report).

Static acceptance checks (the first and last commands below should print nothing):

```bash
rg -n 'synchronize:[[:space:]]*true' src/
rg -n 'onDelete' src/
rg -ni '\.(add)?groupBy\(' src/
rg -n "password:[[:space:]]*['\"]" src/database/data-source-options.ts
```

Homework 14 static checks (each should produce matches):

```bash
rg -ni 'for update|returning|pessimistic_write' src/rentals/checkout.ts
rg -n 'skip_locked' src/jobs/jobs.service.ts
rg -n '40001|40P01' src/database/transaction-retry.service.ts
node -e "const s=require('./package.json').scripts; const bad=['demo:race','demo:workers','demo:retry'].filter(k=>!s[k].includes('with-secrets.sh')); console.log(bad.length ? bad : 'OK'); process.exit(bad.length ? 1 : 0)"
```

The empty-result `rg` checks exit with status 1; this means no prohibited
match was found. The other checks show both RESTRICT/CASCADE and report
GROUP BY. If ripgrep is unavailable, use the equivalent `grep -rn` /
`grep -rniE` checks from the assignment. All connection values come from
`process.env`; the shared options factory is in
`src/database/data-source-options.ts`.

This is the pnpm workflow. The three demo commands include the required vault
wrapper; `SKIP_VAULT=1` selects the explicit fallback without vault access.
Without the fallback, the wrapper runs `infisical run --env=dev -- <command>`
and requires an installed, authenticated CLI with access to the project.
Arguments and child exit codes are preserved in both branches.
Homework 14 was verified on 2026-10-15 from a clean export of commit `2eac4c7`
and a separate empty Compose PostgreSQL volume, without `.env`, local notes,
Resend settings or host credential files. See [Конкурентність](#конкурентність)
for measured results. The pnpm install used the local package cache.
All commands exited 0, the two seed counts matched, and the 13 unit tests,
ESLint, TypeScript and formatting checks passed. Homework 14's required demos
need no Resend key and do not send email; `demo:email` is optional.
Submit the PR URL in the LMS after committing and pushing the homework.

## Homework 14: transactional rentals

Homework 14 adds `renters.balance` (integer kopecks, default 0, `CHECK >= 0`)
and the `RentalJob` entity / `rental_jobs` table through
`AddRentalBalanceAndJobs1792051200000`. Existing renters start with zero credit;
the homework 13 seed does not overwrite balances or create jobs.

Each job references a rental with `ON DELETE RESTRICT` and stores a `new`/`done`
status, a nonnegative `processed` counter, an optional worker name, and a
timezone-aware creation timestamp. The counter may exceed 1 so the worker demo
can detect duplicate processing. A partial index on `(created_at, job_id)` for
new jobs supports ordered queue selection; a separate index covers `rental_id`.
`AddJobEmailRecipient1792051200001` adds the `email_to` recipient snapshot,
backfilling historical jobs from their renter addresses. The race, worker and
retry demos are available through the commands in Grading; all three run
without Resend credentials.

Use the existing `DB_*` connection settings from Grading and run `pnpm run build`
then `pnpm run migrate` to apply the schema. The teacher-approved variant without
Infisical also applies to homework 14 through the wrapper fallback:
export `SKIP_VAULT=1` alongside `DB_*`; no new env file is needed.
The queue/balance migration rollback discards balances and jobs; the later
recipient migration rollback removes only the recipient snapshot. Exercise
rollback on a disposable database.

The integration test requires a completely empty PostgreSQL database named
`retro_hw14_test_*`. It applies the old schema, inserts existing rental data,
applies the homework 14 migrations, checks defaults and constraints through SQL and ORM,
verifies that ORM metadata matches the schema, then exercises down/up while
checking that old renters and rentals survive. It leaves test data in place.
For example, with Docker running and host port 55444 available:

```bash
docker run --detach --rm --name retro-hw14-schema-test \
  --publish 127.0.0.1:55444:5432 \
  --env POSTGRES_USER=hw14_test --env POSTGRES_PASSWORD=hw14_test \
  --env POSTGRES_DB=retro_hw14_test_schema \
  --health-cmd='pg_isready -U hw14_test -d retro_hw14_test_schema' \
  --health-interval=1s --health-timeout=3s --health-retries=30 postgres:18
# Wait until this prints healthy before running the test:
docker inspect --format '{{.State.Health.Status}}' retro-hw14-schema-test
TEST_DATABASE_URL=postgres://hw14_test:hw14_test@127.0.0.1:55444/retro_hw14_test_schema \
  pnpm run test:db:transactions
# Checkout tests require their own empty database:
docker exec retro-hw14-schema-test createdb -U hw14_test retro_hw14_test_checkout
TEST_DATABASE_URL=postgres://hw14_test:hw14_test@127.0.0.1:55444/retro_hw14_test_checkout \
  pnpm run test:db:checkout
# The race CLI integration tests use another empty database:
docker exec retro-hw14-schema-test createdb -U hw14_test retro_hw14_test_race
TEST_DATABASE_URL=postgres://hw14_test:hw14_test@127.0.0.1:55444/retro_hw14_test_race \
  pnpm run test:db:race
# Remove only this temporary container and its anonymous data volume:
docker rm --force --volumes retro-hw14-schema-test
```

### Transactional checkout

`RentalsModule` is imported by `AppModule` and exports the injectable
`RentalsService`. Call `rentalsService.checkout({ renterId, gameId, platformId })`;
Nest supplies the configured DataSource. The service delegates to the same
transactional `checkout(dataSource, request)` function in `src/rentals/checkout.ts`,
which can also be called directly with an initialized DataSource in integration
tests. The operation rents one physical copy for one day and returns
`rentalId`, `gameCopyId`, `jobId`, `chargedAmount`, and the remaining
`balance`. All monetary values are integer minor units of UAH: `2500` means
25 UAH. This is a reusable business operation; no HTTP route is added.

The operation explicitly uses READ COMMITTED and the callback's transaction
manager for every query. Its orchestration calls `ensureRenterExists`,
`findAvailableCopyForUpdate`, and `debitRenterBalance`, then inserts the rental,
item, and confirmation job. The early renter lookup uses TypeORM's
`for_key_share` lock so the renter cannot be deleted or have its key changed
between validation and payment; concurrent non-key balance updates are still
allowed. This is a transactional business check, not HTTP pipe validation.

The copy helper selects an available copy with `FOR UPDATE`, then
checks active rental items again in a separate statement after acquiring the
lock. The second statement gets a fresh snapshot: the first statement may have
waited while another transaction rented that copy. If it is now occupied, the
helper tries the next copy in ascending UUID order. Its `do...while` repeats
while `isCopyRented` finds an active rental in the fresh snapshot. UUID order
is used as a cursor, not as creation-time order. It waits for locked
copies rather than treating them as unavailable with SKIP LOCKED. The locking
protocol must be followed by other code that reserves physical copies; the
existing partial unique index remains the database's final guard against two
active rentals of one copy.

Row locking fits our individual cartridges better than a second, aggregate
stock counter that would need to stay synchronized with their rental history.
Payment uses an atomic `UPDATE ... SET balance = balance - price WHERE
balance >= price RETURNING balance`, so concurrent payments cannot overwrite
one another or overdraw the account. Rental, rental item (with its price
snapshot), and confirmation job are inserted before the same transaction
commits. The confirmation is only queued here, not sent within checkout.

Expected refusals throw `CheckoutError` with one of these codes:
`INVALID_INPUT`, `COPY_UNAVAILABLE`, `RENTER_NOT_FOUND`, or
`INSUFFICIENT_BALANCE`. Unexpected SQL/connection errors propagate to the caller;
the operation rolls back rather than reporting them as normal refusals. If
several conditions fail, input format is checked first, then renter existence,
copy availability, and sufficient balance. The key-share lock keeps the renter
present, so a zero-row debit result means insufficient funds. The separate
TransactionRetryService is demonstrated by `demo:retry`; checkout retains
its existing READ COMMITTED locking protocol.

`pnpm run test:db:checkout` runs twelve integration cases on an empty
`retro_hw14_test_*` database: success and price snapshot, insufficient funds,
unavailable copies, invalid input/missing renter, rollback on an actual SQL
failure during job insertion, concurrent requests for the same copy, concurrent
payments from one account for different games, and lock waits followed by
commit/rollback. It also checks early renter validation, concurrent renter
deletion, and resolving/calling RentalsService from a real AppModule application
context without starting an HTTP server. Lock-wait tests observe
`pg_stat_activity` before releasing the other transaction rather than depending
on a fixed sleep. Both database test
suites leave their fixtures in place, so use new empty databases for reruns.

## Конкурентність

`pnpm run demo:race` starts a Nest application context without an HTTP server,
using the existing `DatabaseModule` and `RentalsModule`. Only the existing
database configuration is required; no `PORT` or new env file is needed.
Use `SKIP_VAULT=1` from Grading to run the wrapper without Infisical. Apply migrations and build first.

Every run adds a fresh game/platform, ten physical copies priced at 2500 minor
units per day, and fifty renters with balances of 100000 each. Each renter
requests one copy of that same game/platform through `RentalsService.checkout`.
The fixture is inserted in one transaction. New UUIDs keep runs independent:
the script never truncates tables, deletes old rentals, or resets old balances.
It leaves the new data and confirmation jobs for inspection. Run it after
homework 13 count/report checks, since it adds rows to those tables.

All fifty calls start in one `map`, and `Promise.allSettled` waits for every
commit or rollback, including the forty expected refusals. There is no
application queue or sequential await per checkout. The existing three-connection
pool limits simultaneous database transactions; calls waiting for a connection
are still part of the concurrent workload.

For an isolated run with the project's Compose configuration, choose an unused
host port (55445 below) and a separate project:

```bash
export COMPOSE_PROJECT_NAME=retro-hw14-race PGBOUNCER_PORT=55445 POSTGRES_PORT=55446 PORT=33016 SKIP_VAULT=1
export DB_PORT="$PGBOUNCER_PORT"
export DB_HOST=127.0.0.1 DB_USER=db_migrator DB_PASSWORD=migration_dev DB_NAME=rental
unset DB_PASSWORD_FILE
docker compose up -d --wait
pnpm run build
pnpm run migrate
pnpm run demo:race
pnpm run demo:race
# Optional cleanup of this dedicated demo project only:
docker compose -p retro-hw14-race down --volumes
```

No normal catalog seed is required: the race supplies its own small fixture.
The command prints a JSON report with a nonzero exit code on an invariant
violation or any unexpected checkout error. The report is scoped to that run's
game and renters, so previous runs do not inflate its numbers.

Measured on 2026-10-15 from a clean export of commit `2eac4c7`, with a fresh
Compose PostgreSQL 18 database and the existing pool size of 3. The full
Grading sequence ran successfully, including two seeds, N+1 and report checks,
then all three homework 14 demos:

| Metric | Result |
| --- | ---: |
| Attempts / successful / unavailable | 50 / 10 / 40 |
| Initial / final stock | 10 / 0 |
| Negative stock rows / double-booked copies | 0 / 0 |
| Rentals / items / jobs | 10 / 10 / 10 |
| Total charged, in minor units | 25000 |
| Unexpected errors | 0 |
| Checkout workload time, excluding fixture setup | 377 ms |
| Worker tasks / distribution | 10 / 5 + 5 |
| Worker tasks processed twice | 0 |
| Worker elapsed / sequential handler time | 2615 / 5000 ms |
| Retry SQLSTATE / retry count | 40001 / 1 |
| Transaction attempts A / B | 1 / 2 |
| Retry initial / final balance | 10000 / 13000 |

Time varies by machine and database load. The demo checks its essential totals:
ten successes, forty stock refusals, no available or double-booked copies,
ten rentals/items/jobs, and the correct total charged. The more detailed
per-renter, price snapshot, and transaction checks remain in the checkout tests.
The scenario lives in `src/scripts/demo-race.ts`, and its fixture is in
`src/database/fixtures/race-data.ts`. `readRaceState` loads the relevant entities
and relations through TypeORM; ordinary array operations calculate the counters.

**Domain mapping:** this service tracks individual cartridges rather than a
stored aggregate stock column. `finalStock` counts copies with no active rental.
For each copy, derived remaining capacity is `1 - count(active rental items)`;
`negativeStockRows` counts copies where that value is negative. This is also
`doubleBookedCopies`, so these fields report actual duplicate reservations
rather than a hardcoded zero. The existing partial unique index independently
prevents two active rental items for one physical copy. This is the rental-domain
adaptation of the assignment's numeric-stock benchmark.

`pnpm run test:db:race` requires an empty `retro_hw14_test_*` PostgreSQL database
via `TEST_DATABASE_URL`. It invokes the actual CLI twice and checks that earlier
data survives. It then forces a real SQL error during job insertion: all fifty
checkouts roll back, no charges or rentals remain from that run, and the CLI
exits with code 1 instead of treating database errors as stock refusals. A third
test uses a database trigger to change the payment total and verifies that the
CLI also rejects an incorrect charge even when ten checkouts succeed.

Worker and retry measurements are included in the table above. `demo:workers` consumes
only its own ten tasks; the ten tasks created by `demo:race` remain `new`.
This keeps repeated demos independent and avoids treating race fixtures as real
email recipients. The offline worker demo measures database processing counters;
external email deduplication has the separate limits described in
[workers and Resend](#rental-confirmation-workers-and-resend-homework-14).
See [transaction retries](#transaction-retries-homework-14) for the retry mechanism
and why only the two concurrency SQLSTATEs are retried.

## ORM seed

After exporting the CLI credentials from `Grading`, building and applying
migrations, run `pnpm run seed`. The standalone script uses the shared
DataSource without starting Nest or an HTTP server.

The entire checked-in Retronian catalog is imported offline from
`db/fixtures/retronian/*.tsv`: its UUIDs, text, dates and relations are preserved.
`csv-parse` handles CSV quoting with a tab delimiter; Zod validates the input,
and PostgreSQL `\N` fixture markers become `null`. The data attribution and
license remain in `db/fixtures/retronian/NOTICE.md` and `LICENSE-DATA.md`.
`platform_formats.tsv` supplies formats for physical copies; it is not a SQL
table. Generated `search_vector` values are computed by PostgreSQL.

`src/database/fixtures/homework-data.ts` adds ten physical copies of selected
catalog games, ten fictional renters, ten rentals and twenty rental items.
Every rental has two items. Nine rentals are returned and the last is active;
returned copies are reused without overlapping rental periods. Dates and IDs
are fixed, and all prices are integer kopecks. Each item's historical daily
price is 500 kopecks below its copy's current price.

The seed inserts batches of at most 500 records in FK dependency order, within
one transaction. Conflicts on the explicit primary key (including composite
keys) use `DO NOTHING`: existing rows are preserved rather than overwritten.
Conflicts on other unique constraints remain errors and roll back the whole
transaction. The script closes its DataSource and returns a nonzero exit code
on failure. It creates no tables and does not delete existing data.

Run the seed twice, then use this command after each run. Counts must stay the
same. On a fresh migrated database the expected counts are:

| Table | Rows |
| --- | ---: |
| platforms | 19 |
| genres | 16 |
| games | 19,896 |
| game_platforms | 21,441 |
| game_genres | 154 |
| game_copies | 10 |
| renters | 10 |
| rentals | 10 |
| rental_items | 20 |

```bash
docker compose exec -T -e PGPASSWORD=migration_dev db \
  psql -h 127.0.0.1 -U db_migrator -d rental <<'SQL'
SELECT 'platforms' AS table_name, count(*) AS rows FROM platforms
UNION ALL SELECT 'genres', count(*) FROM genres
UNION ALL SELECT 'games', count(*) FROM games
UNION ALL SELECT 'game_platforms', count(*) FROM game_platforms
UNION ALL SELECT 'game_genres', count(*) FROM game_genres
UNION ALL SELECT 'game_copies', count(*) FROM game_copies
UNION ALL SELECT 'renters', count(*) FROM renters
UNION ALL SELECT 'rentals', count(*) FROM rentals
UNION ALL SELECT 'rental_items', count(*) FROM rental_items;
SQL
```

These are the default Compose development credentials. If you customize them,
use the corresponding password, role and database in the count command.
An existing database may contain additional rows; repeated seed runs must
still leave their counts unchanged. The old `db/seed.sql` and
`db/seed-benchmark.sql` remain homework 12 materials and are not invoked by
this seed.

## N+1 demonstration

With the CLI environment from `Grading`, build, migrate and seed first, then run:

```bash
pnpm run demo:nplus1
```

The script reads rental history with the graph
`rental → items → gameCopy → game`. It selects the ten latest rental IDs in
deterministic order, then measures the same five and ten IDs through three
loaders. DataSource initialization and ID selection are setup outside the
measurements. The demo performs no seed, migrations or data writes.

`QueryCountLogger` receives real queries from TypeORM with
`logging: ['query']`, resets before each loader and prints the full SQL and
parameters. The naive loader selects rentals, then loads items per rental,
and a copy and game per item. The fix loads the same graph with three explicit
`leftJoinAndSelect` calls. Deep assertions compare all loaded fields after
sorting rental/item arrays, including nullable return dates and price snapshots.

Measured on the committed seed (two items per rental), TypeORM 0.3.31 and PostgreSQL 18:

| Rentals (N) | Items | Before: SELECTs in loops | After: LEFT JOIN | After: LEFT JOIN with `take(N)` |
| ---: | ---: | ---: | ---: | ---: |
| 5 | 10 | 26 | 1 | 2 |
| 10 | 20 | 51 | 1 | 2 |

The naive count is `1 + N + 2 × items`, or `1 + 5 × N` for this seed.
Repeated copies/games still produce repeated SELECTs in the naive loops.
Both fixed counts stay constant when N doubles. With three relation levels,
both are below the assignment limit `1 + 2 × 3 = 7`.

The paginated JOIN is measured separately: TypeORM first selects distinct
rental IDs with a limit, then fetches their complete graph. This avoids
limiting joined SQL rows and accidentally cutting off a rental's items.
The ID page has the same ordering and rentals as the other loaders.
The final output includes:

```text
N=5: before=26, after=1, afterWithPagination=2; results match (10 items)
N=10: before=51, after=1, afterWithPagination=2; results match (20 items)
```

The script verifies growth before the fix, constant counts afterward, and
equivalent results; it exits nonzero if any assertion fails. These exact
counts assume the committed seed's two items per rental. Additional rental
data can change the naive counts while the JOIN strategy remains constant.

## Platform popularity report

After building, migrating and seeding with the CLI environment from `Grading`, run:

```bash
pnpm run report
```

`src/scripts/report.ts` uses `createQueryBuilder()` with LEFT JOINs across
`platforms → game_copies → rental_items`, GROUP BY and
`getRawMany<PlatformPopularityRow>()`. It reports popularity over all time,
including active rentals. Each rental item counts once, even when the same
physical copy has been rented multiple times. `COUNT(DISTINCT rental_id)`
counts each rental once per platform, even if it contains multiple copies
for that platform.

All platforms appear, including those without rentals. Counting the joined
item's non-null rental ID rather than `COUNT(*)` keeps their counts at zero.
Rows are ordered by item count descending, then platform name and ID.
PostgreSQL COUNT returns bigint, so counts stay strings instead of being
converted to potentially unsafe JavaScript numbers. The script only reads
data, closes its DataSource, and returns a nonzero exit code on failure.

Expected nonzero rows from the committed seed:

| Platform | Rental items | Distinct rentals |
| --- | ---: | ---: |
| Nintendo Entertainment System | 4 | 3 |
| Super Nintendo Entertainment System | 4 | 4 |
| Game Boy | 2 | 2 |
| Game Boy Advance | 2 | 2 |
| Nintendo DS | 2 | 2 |
| PlayStation | 2 | 2 |
| PlayStation Portable | 2 | 2 |
| Sega Mega Drive | 2 | 2 |

The other eleven platforms have zero counts. Rental 8 has both Mega Man 2
and Metroid for NES, which illustrates why its four positions belong to
only three different rentals. Summing distinct rental counts across platforms
does not give the global number of rentals: one rental can span platforms.

We use Repository `find`/`findOne` when the result is entities with simple
filters and relations. We use QueryBuilder when we need aggregates, grouping
or a custom SELECT shape such as these report rows. QueryBuilder can itself
be created from a Repository; these are complementary APIs.

## TypeORM entities and relations

All nine homework tables are mapped in `src/database/entities` and registered
in the shared DataSource options. SQL table/column names, primary keys,
nullability, enum names and values, length constraints, unique constraints,
and the manual `rented_at` timestamp are retained.

| Entity | Table | Primary key |
| --- | --- | --- |
| `Game` | `games` | `game_id` |
| `Platform` | `platforms` | `platform_id` |
| `GamePlatform` | `game_platforms` | `game_id`, `platform_id` |
| `GameCopy` | `game_copies` | `game_copy_id` |
| `Genre` | `genres` | `genre_id` |
| `GameGenre` | `game_genres` | `game_id`, `genre_id` |
| `Renter` | `renters` | `renter_id` |
| `Rental` | `rentals` | `rental_id` |
| `RentalItem` | `rental_items` | `rental_id`, `game_copy_id` |

`GamePlatform`, `GameGenre`, and `RentalItem` are explicit join entities.
`RentalItem` owns the historical daily price and return timestamp; a plain
`ManyToMany` would lose this domain data. Every FK has a `ManyToOne` with an
explicit `JoinColumn`, paired with the parent's inverse `OneToMany`.
No `OneToOne` exists in this schema. Relations use `Relation<T>` to avoid
runtime reflection depending on circular class imports; this wrapper does
not change the domain type. Relations are loaded explicitly, without eager
loading, lazy promises, or automatic ORM save/remove cascades.

### Money and date values

The new schema uses integer kopecks: `125.50 UAH` is `12550`.
SQL column names remain `game_copies.price_per_day` and
`rental_items.cost_per_day`; their TypeScript properties are
`pricePerDay` and `costPerDay`. Both retain a `CHECK >= 0`.
The rental item's price is a snapshot, independent of later copy price changes.

This differs from homework 12's `numeric(10,2)` major-unit columns.
The initial migration targets an empty database; it does not convert the old
data volume, and old SQL seeds are not the seed for the new integer schema.

PostgreSQL `date` columns map to `YYYY-MM-DD` strings, while `timestamptz`
columns map to `Date`. Nullable fields include `null` in their TypeScript type.
Generated UUID primary keys use `gen_random_uuid()`. The driver option
`uuidExtension: 'pgcrypto'` selects that expression, while
`installExtensions: false` prevents automatic extension installation:
PostgreSQL 18 already provides the UUID function natively.

### Foreign-key deletion policy

These are database `ON DELETE` rules, distinct from ORM `cascade` options.
`RESTRICT` protects rental history and physical copies. `CASCADE` removes
catalog membership rows that have no independent history.
The historical SQL schema omitted `ON DELETE`; these explicit policies are
intentional changes for the ORM schema.

| Child FK → parent | ON DELETE | Reason |
| --- | --- | --- |
| `game_platforms.game_id` → `games.game_id` | CASCADE | Remove catalog membership |
| `game_platforms.platform_id` → `platforms.platform_id` | CASCADE | Remove catalog membership |
| `game_genres.game_id` → `games.game_id` | CASCADE | Remove catalog membership |
| `game_genres.genre_id` → `genres.genre_id` | CASCADE | Remove catalog membership |
| `game_copies.game_id` → `games.game_id` | RESTRICT | Keep copies linked to their game |
| `game_copies.platform_id` → `platforms.platform_id` | RESTRICT | Keep copies linked to their platform |
| `rentals.renter_id` → `renters.renter_id` | RESTRICT | Preserve the renter's rental history |
| `rental_items.rental_id` → `rentals.rental_id` | RESTRICT | Preserve historical rental positions |
| `rental_items.game_copy_id` → `game_copies.game_copy_id` | RESTRICT | Preserve the rented copy's identity |

### PostgreSQL-specific schema objects

`Game.searchVector` retains the original weighted `simple` expression as a
non-null `GENERATED ALWAYS ... STORED` column. PostgreSQL computes it; ordinary
ORM inserts/updates do not write it, and ordinary selects omit it.

The partial unique index `one_active_rental_per_copy` is described with
`@Index`: only rows with `returned_at IS NULL` participate.
Three index names are registered with `synchronize: false` and must be created
explicitly in the migration: `idx_games_lower_name_uk` (expression),
`idx_games_search_vector` (GIN), and `idx_rentals_renter_history`
(`renter_id, rented_at DESC, rental_id DESC`). This prevents later schema diff
from treating the manually maintained indexes as unwanted objects.

The initial migration also carries over both functions and triggers from
`db/schema.sql`: `check_rental_returned_at` / `rental_items_returned_at_check`
and `check_rental_rented_at` / `rentals_rented_at_check`.
Entities alone do not install these objects or create the business tables.

## Initial migration

`src/migrations/1791301576818-InitialRentalSchema.ts` was generated by the
TypeORM CLI against a separate empty PostgreSQL database, then reviewed and
extended. Its `up()` creates nine business tables, three enums, keys,
non-negative integer price checks, the generated search vector, four application
indexes, and both date-validation functions and triggers from homework 12.
The generation workflow was:

```bash
pnpm run build
pnpm run migration:generate src/migrations/InitialRentalSchema
# Review the generated SQL and add the manual PostgreSQL objects.
pnpm run build
pnpm run migrate
pnpm run migrate:show
```

This generation block describes how the committed migration was created;
do not regenerate a second initial migration against an empty database.
For later changes, apply existing migrations first, change entities, rebuild,
and generate a new migration.

The generated file contained the generation database name in its
`typeorm_metadata` insert/delete. Those statements now use `current_database()`
so that another `DB_NAME` works too. This table stores the generated-column
expression; `migrations` stores migration history. TypeORM creates these two
service tables, separate from the nine business tables.

`down()` removes manual triggers, functions and indexes, then generated
foreign keys, tables and enums. It removes the search-vector metadata row;
the two TypeORM service tables remain, with no applied migration record or
generated-column record after rollback. No broad `DROP ... CASCADE` is used.
Rolling back this initial migration deletes business data. Reapplying it
restores the structure, not the deleted rows; use the rollback exercise only
on a disposable database.

After applying all migrations, check schema drift without creating a file:

```bash
pnpm run migration:generate .local/migrations/SchemaDrift --check
```

The expected result is `No changes in database schema were found`, exit 0.
The manually maintained indexes are registered by name with
`synchronize: false`, so generation does not attempt to remove them.
With the pinned TypeORM 0.3.31 and pg 8.23.0 versions, schema inspection can
also print a `client.query()` deprecation warning from TypeORM's internal
parallel enum introspection. The check still succeeds with exit 0.

Migration verification covers negative prices, duplicate active rentals,
invalid return dates on insert/update, moving a rental start beyond a recorded
return, all five history/copy restrictions and all four catalog cascades.
ORM relation loading and the independence of historical daily prices were
also checked. `db/schema.sql` and the old SQL seeds remain homework 12
materials; do not apply them on top of the ORM migration schema.

## Homework 12: catalog data

After applying `db/schema.sql` to an empty database, run `./scripts/seed.sh`
to import only the real Retronian catalog: games, platforms, genres, and their
relationships. Physical copies, renters, and rental history start empty.
Apply `db/indexes.sql` to enable the application indexes.

The previous homework dataset is preserved in `db/seed-benchmark.sql`.
To reproduce its measurements, use the workflow below on an empty database.
Neither seed is intended to be run twice on an already seeded database.

## Homework 12: SQL benchmark workflow

These historical commands target the original numeric-money SQL schema in a
separate database. Do not apply this schema or its SQL seeds on top of the
TypeORM schema. For homework 13, use [Grading](#grading).

Run every command in this section from the repository root. The main benchmark
table is `rentals` (100,000 seeded rows), and the Q4 catalog-search table is
`games` (100,000 seeded rows).

### Start and connect

A fresh clone needs no manually created credential files. This one command
initializes the credentials volume and starts PostgreSQL:

```bash
export POSTGRES_PORT=55432 && docker compose up -d --build --wait db
```

`POSTGRES_PORT` selects the host port; PostgreSQL continues to listen on its standard
port `5432` inside the container.

Connect with `psql` inside the container:

```bash
docker compose exec db psql -U db_admin -d rental
```

For DBeaver, use host `localhost`, port `55432`, database `rental`, user
`db_admin`, and the local dev password `admin_dev`.

For a non-interactive connection check, run:

```bash
docker compose exec -T db psql -U db_admin -d rental -Atc 'SELECT 1'
```

### Create and seed the database

Apply the schema to an empty database:

```bash
docker compose exec -T db \
  psql -U db_admin -d rental -v ON_ERROR_STOP=1 \
  < db/schema.sql
```

Load the fixture and generated benchmark data:

```bash
./scripts/seed.sh db/seed-benchmark.sql
```

The seed finishes with `VACUUM (ANALYZE)`. Verify the two required table sizes:

```bash
docker compose exec -T db psql -U db_admin -d rental -c \
  "SELECT
     (SELECT count(*) FROM rentals) AS rentals,
     (SELECT count(*) FROM games) AS games;"
```

### Compare plans before and after indexes

Before applying `db/indexes.sql`, capture the four baseline plans:

```bash
for query in db/queries/q{1..4}.sql; do
  ./scripts/explain.sh "${query}"
done
```

Each baseline plan must contain a `Seq Scan`. Then create the optimization
indexes and refresh planner statistics:

```bash
docker compose exec -T db \
  psql -U db_admin -d rental -v ON_ERROR_STOP=1 \
  < db/indexes.sql
docker compose exec -T db psql -U db_admin -d rental -c 'ANALYZE;'
```

Run the same loop again. Each optimized plan must name the corresponding index
from `db/indexes.sql` and must not contain a `Seq Scan`. Run Q4 two more times
to warm its GIN index and use the final result:

```bash
for query in db/queries/q{1..4}.sql; do
  ./scripts/explain.sh "${query}"
done
./scripts/explain.sh db/queries/q4.sql
./scripts/explain.sh db/queries/q4.sql
```

The captured before/after plans and the Ukrainian morphology experiment are in
[db/OPTIMIZATIONS.md](db/OPTIMIZATIONS.md).

To repeat the entire experiment, `docker compose down -v` removes the database
volume; this permanently deletes its local data, so use it only when a clean
database is intended.

### Application connection configuration

The API uses `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME`, and
`DB_PASSWORD_FILE`. CLI commands use the same connection contract with
`DB_PASSWORD` instead. Password rotation needs no API restart.

## Tests

```bash
pnpm run test --runInBand
```

Database behavior is verified through the fresh-database workflow above.

### Integration testkit (homework 16, step 1)

With Node 24, pnpm and a running Docker daemon:

```bash
pnpm install --frozen-lockfile
pnpm test:integration
pnpm test:integration
```

No Compose stack, vault credentials or working database is needed. The command
removes the previous dist-test output so deleted tests/migrations cannot linger,
then compiles application code and integration tests with `tsc -p tsconfig.test.json`
into ignored `dist-test/`, preserving Nest/TypeORM decorator metadata, then runs
Jest against that JavaScript without another transformer. Unit tests keep their
own `jest.config.cjs`; the integration config uses `reporters: ['default']`,
`verbose: true` and `maxWorkers: 1`.

For Rancher Desktop, export its socket settings before running the commands:

```bash
export DOCKER_HOST="unix://${HOME}/.rd/docker.sock"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

These are the [Testcontainers Rancher Desktop settings](https://node.testcontainers.org/supported-container-runtimes/#rancher-desktop).
Ryuk stays enabled. Docker Desktop normally needs no additional settings.
The first run may take longer while downloading the PostgreSQL/Ryuk images.

`test/integration/testkit/postgres.ts` creates a disposable `postgres:16-alpine`
container with a random host port and password, then runs the existing TypeORM
migrations with `synchronize: false`. Its connection settings come exclusively
from the [PostgreSQL container getters](https://node.testcontainers.org/modules/postgresql/),
without reading or modifying the developer's `DB_*` environment. The returned
`environment` contains the container's `DB_*` fields for later AppModule tests;
those tests must apply them and unset `DB_PASSWORD_FILE` before building AppModule.

Isolation uses a fresh container per suite and `TRUNCATE ... RESTART IDENTITY
CASCADE` before each test. Truncation preserves the migrated schema and migration
history while clearing all mapped application tables; it also works for future
HTTP tests whose transactions can use different pool connections. One worker
limits concurrent containers. Teardown closes the DataSource and removes the
container and its volumes; initialization/migration failures trigger cleanup too.

`aRenter(overrides)` builds renters with unique IDs, emails and phone numbers.
`aCatalog({ pricePerDay })` builds a linked game, platform, association and physical
copy. Both return plain data; tests choose when and how to persist it.

The current three smoke tests verify PostgreSQL 16 migrations, renter builder
round trips, and catalog persistence/reset. The two-repository suite and its
constraint/SQL cases are the next homework step; E2E and Pact follow later.

### Rental confirmation workers and Resend (homework 14)

After exporting the `DB_*` CLI credentials from Grading:

```bash
pnpm run build
pnpm run migrate
pnpm run demo:workers
```

`demo:workers` creates ten rental tasks and starts two async workers. Each uses
TypeORM QueryBuilder's `pessimistic_write` + `skip_locked` to claim one task;
processing, `processed + 1`, `worker` and `done` stay in the same transaction.
The demo handler waits 500 ms and needs no email credentials. It only consumes
its own task IDs, preserving unrelated tasks. A locked `new` task is still pending:
a worker rechecks the queue instead of exiting on the first empty claim.
A handler failure rolls back the task so a subsequent run can pick it up.
Verified PostgreSQL 18 run: 10 tasks, distribution 5 + 5, duplicates 0,
2615 ms elapsed versus 5000 ms sequential handler time (machine-specific).
The script prints distribution, duplicate count and elapsed/sequential time,
and exits nonzero if its invariants fail.

Real email uses the same `JobsService` with a Nest `EmailService` backed by the
Resend SDK. Set `RESEND_API_KEY` privately in your local environment and set
`EMAIL_FROM` to an address on your verified Resend domain. These settings are
required only by `start:worker` and `demo:email`; no API key is required for grading.

```bash
export EMAIL_FROM='Retro Games Rental <notifications@send.your-domain.dev>'
# RESEND_API_KEY must already be set privately.
pnpm run demo:email
```

This creates one rental and sends one confirmation to `delivered@resend.dev`
(the Resend test sink). To receive it yourself, export `DEMO_EMAIL_TO` with your
own address before running the command. The demo prints its task ID before
sending. To retry an existing task, reuse that ID instead of creating a new demo:

```bash
pnpm run start:worker YOUR_JOB_UUID
```

Application entry points and modules:

- `src/worker/main.ts` starts a standalone Nest application for selected task IDs.
- `src/worker/worker.module.ts` composes database, queue and email dependencies.
- `src/jobs/rental-confirmation.worker.ts` is the injectable confirmation handler.
- `src/scripts/demo-email.ts` creates demo data and invokes that same worker.

Both commands finish once their selected tasks are drained; there is no permanent
polling service or signal-handling lifecycle in this step. The API starts separately
through `src/main.ts` and does not start email workers implicitly.

Only explicitly selected task IDs are consumed. Already completed tasks are
skipped. The real-email command uses one worker and spaces requests by at least
600 ms after each API response; it is not a throughput benchmark or a distributed
rate limiter. API errors fail the command and leave the task `new` for a later
retry. Automatic provider retries and delivery webhooks are outside this step.

The `email_to` migration snapshots the recipient at checkout; existing tasks are
backfilled from the current renter address. Message content uses the immutable
rental ID. Keep the sender and message template unchanged when retrying pending
tasks: Resend requires identical payloads for the same idempotency key
`rental-confirmation/<jobId>`. A crash after API acceptance but before database
commit can repeat the request; Resend deduplicates that key for **24 hours**.
After that window, duplicate email remains possible. `done` means the provider
accepted the request, not that the email reached the inbox. Database counters
commit once; PostgreSQL cannot roll back an external email.

References: [Resend Node SDK](https://resend.com/docs/send-with-nodejs),
[idempotency and the 24-hour limit](https://resend.com/docs/dashboard/emails/idempotency-keys).

Integration checks (each suite needs a separate empty disposable database named
`retro_hw14_test_*`, through `TEST_DATABASE_URL`):

```bash
pnpm run test:db:workers
pnpm run test:db:transactions
pnpm run test:db:checkout
```

### Source layout and module ownership

Entities live with their functionality:

```text
src/
  catalog/entities/  # games, copies, platforms, genres and their links
  renters/entities/  # renters
  rentals/           # checkout, RentalsModule/Service and rental entities
  jobs/              # queue service, rental task entity and confirmation worker
  email/             # reusable email transport and its Nest module
  database/          # connection setup, entity registration and fixtures
  config/            # validated configuration
  migrations/        # shared database schema history
  worker/            # standalone application entry point and composition module
  scripts/           # demos, seed and reports
```

`database/entities.ts` collects the entities for the shared DataSource and
TypeORM CLI; feature code imports its entities directly. Moving files does not
change tables or require another migration.

`EmailService` is an injectable provider. Its `send()` method accepts a recipient,
subject, plain-text body and caller-supplied idempotency key, without knowing
about rentals or database entities. `EmailModule` owns its Resend client and
configuration providers, and exports only `EmailService` for other modules.

`RentalConfirmationWorker` builds the rental-specific subject, body and stable
idempotency key. `RentalConfirmationModule` owns and exports this provider,
importing `JobsModule` and `EmailModule`. `JobsModule` owns the queue processing
service; using it for offline demos does not require email credentials.
`WorkerModule` composes database and confirmation modules for the standalone
entry point. A module groups and exposes providers; a service does the work.

### Transaction retries (homework 14)

With the same `DB_*` CLI settings from Grading, after building and migrating:

```bash
pnpm run demo:retry
```

The demo creates a new renter with balance 10000; it never resets prior data.
Two `REPEATABLE READ` transactions add 1000 and 2000 via read-modify-write.
Promises coordinate the first attempts: B reads 10000 before A starts, A commits
11000, then B attempts its stale write. PostgreSQL rejects B with a real `40001`.
A fresh transaction reruns B's read and writes 13000. The script prints attempts,
retry codes/delays and final balance. It requires at least one serialization
failure, a correct final balance and consistent attempt/retry counters.
Additional retryable conflicts are allowed within the service attempt limit;
A=1/B=2 and one retry describe a typical run, not a correctness requirement.
Coordination is used only on B's first attempt. Failure paths release the waiting
transaction and wait for both outcomes before closing the Nest context.

`DatabaseModule` exports `TransactionRetryService`. Its `run(isolation, work,
options)` method invokes `DataSource.transaction` anew for every attempt, so
reads, decisions, writes and commit all run again. The callback receives that
transaction's manager and its attempt number; use this manager for all database
work. `maxAttempts` defaults to 3 (including the initial attempt). Backoff starts
at 50 ms and doubles up to 1000 ms, with an additional 0–24 ms random jitter.
Each retry is logged through Nest Logger, or through the caller's `onRetry`
callback; the demo collects these events in its JSON report.

Only SQLSTATE `40001` (serialization failure) and `40P01` (deadlock) trigger a
retry. These can be resolved by running the transaction against fresh state.
Other errors, such as a unique constraint violation, malformed SQL, insufficient
balance or a connection failure, are propagated immediately. After the last
allowed attempt, the original error is propagated. TypeORM's transaction promise
rejects after rollback/release, so backoff does not hold the failed transaction's
connection or row locks. This wrapper is not applied automatically to checkout
or external email sends; its callback should contain repeatable database work.
The existing checkout remains on `READ COMMITTED` with its current locks.

```bash
# Requires a new empty disposable retro_hw14_test_* database:
pnpm run test:db:retry
```

The integration suite checks the real 40001 demo twice, a real 40P01 deadlock,
exhaustion after three real conflicts with earlier writes rolled back, and a
non-retryable SQL failure without a hung CLI.

Reference: [PostgreSQL serialization failure handling](https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html).

### Homework 14 review follow-up (2026-10-22)

The three demos now enter through `scripts/with-secrets.sh dev ...`.
`SKIP_VAULT=1` is the documented grading/local fallback; existing DB credentials
are passed through without calling Infisical. The retry demo accepts additional
concurrency conflicts and validates the final balance instead of hardcoding
exactly one retry. A regression test injects an extra SQLSTATE 40001 to verify
that a correct run with A=2/B=2 succeeds.

```bash
pnpm run test:secrets
# On a new empty disposable retro_hw14_test_* database:
pnpm run test:db:retry
```
