# PostgreSQL restore-drill — homework 15

Recorded on **2026-10-23**. Source code: commit `9845078` (`backup restore drill`).
The application was exported from Git into a new temporary directory, without
local `.env`, `node_modules`, `dist` or existing backups. Dependencies were
installed with `pnpm install --frozen-lockfile`. Commands ran with a cleared
environment, public Compose development credentials and `SKIP_VAULT=1`.
Infisical was not used.

## Environment and data

- Node.js 24.19.0, pnpm 10.24.0, Docker 29.5.2, Compose 2.38.2.
- PostgreSQL 18.6; source behind PgBouncer `v1.26.1-p0`, transaction mode,
  pool size 5 per database/user, maximum 100 clients.
- Disposable Compose project `retro-hw15-test-grading`; new source volumes,
  ports PostgreSQL 55451, PgBouncer 56451, HTTP 33015.
- Three application migrations, then the checked-in seed: 19,896 games,
  19 platforms, 16 genres, 21,441 game/platform links, 154 game/genre links,
  10 copies, 10 renters, 10 rentals and 20 rental items.
- Destination: local `backups/` outside the database container. The archive and
  adjacent JSON are a pair; both are excluded from Git.

## Archive and measured results

Archive:
`rental-2026-10-23T14-28-16-704Z-743bb0ce-3df2-4e93-b8fd-a07dc26f950a.dump`

Metadata completion time: `2026-10-23T14:28:17.388Z` (UTC).
Archive size: **1,935,085 bytes** (about 1.94 MB).
SHA-256: `644931ea5853676ac9595c9cf2bf74704cd23e93363837a147b839eb4e800eb2`.
`pg_restore --list` successfully read the custom-format archive's contents.

| Measurement                                       |         Run 1 |         Run 2 |
| ------------------------------------------------- | ------------: | ------------: |
| Restore command, including `docker exec`          | 0.888 seconds | 0.871 seconds |
| Measured drill RTO: creation through verification | 3.017 seconds | 2.991 seconds |
| Restored `game_copies` rows                       |            10 |            10 |
| Restored `sum(price_per_day)`                     |         36250 |         36250 |
| Result / process exit code                        |     MATCH / 0 |     MATCH / 0 |

The JSON records these controls from the same exported snapshot as `pg_dump`:

```text
table=public.game_copies exists=true rows=10 sumPricePerDay=36250
```

Source controls were `10|36250` before and after both drills. Each restore used
a newly created, uniquely named container and empty volume. The container had
no published ports and networking was disabled. The helper checked that the
target had no user tables, restored the archive and compared table presence,
row count and price sum with the saved JSON. Both temporary containers and
volumes were removed before printing `MATCH`.

## Reproduce

From a fresh checkout with the prerequisites above; the project name below must
not already have volumes. The port overrides avoid an existing development stack.
If using Rancher Desktop, configure its Docker context or `DOCKER_HOST` first.

```bash
export COMPOSE_PROJECT_NAME=retro-hw15-test-grading
export POSTGRES_PORT=55451 PGBOUNCER_PORT=56451 PORT=33015
pnpm install --frozen-lockfile
docker compose up -d --wait
export DATABASE_URL="postgresql://db_migrator:migration_dev@127.0.0.1:${PGBOUNCER_PORT}/rental"
export SKIP_VAULT=1
export DB_HOST=127.0.0.1 DB_PORT="$PGBOUNCER_PORT" DB_USER=db_migrator DB_PASSWORD=migration_dev DB_NAME=rental
unset DB_PASSWORD_FILE
pnpm run build
pnpm run migrate
pnpm run seed
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
# Only for the disposable project selected above, after recording the result:
docker compose down --volumes
```

The minimal grading sequence was also tested before migrations: startup → backup
→ restore returned `MATCH exists=false rows=0 sumPricePerDay=0`, exit 0. That
bootstrap-only result is distinct from the populated-data measurements above.

## Other acceptance checks

The same clean export passed 4 PgBouncer integration tests, 4 backup tests,
6 restore tests, 15 unit tests and 3 secret-wrapper tests. The pooler suite
checked the actual Nest client's address in `SHOW CLIENTS`, transaction mode,
pool limits, queued clients and password rotation. `SHOW POOLS` also reported
`transaction` for the application's `rental` pool.

Both application TypeScript configurations and full-repository ESLint passed;
the latter required installing the standalone `tools/lms-client` dependencies
with its own lockfile. `.env.example` passed validation, and the homework's cron
expression check found one nightly backup command. No actual Infisical credentials
or installed cron job were needed for these checks.

## RTO, RPO and limits

**RTO measured here is 3.017 seconds / 2.991 seconds**, from volume/container
creation through PostgreSQL readiness, restore and control verification.
Archive selection and cleanup are outside this interval. Images were available
locally. This is a local database recovery-duration measurement, not a production
RTO commitment: incident detection, host recovery, backup transfer, application
startup and traffic switching were not measured.

**Nominal RPO is up to about 24 hours** with successful nightly backups at 03:00
in the cron host's timezone. This is calculated from the schedule, not measured
by these two drills. The snapshot precedes dump completion; dump duration and
scheduler delays add to that interval. Missed runs make the data-loss window
longer. `backup.cron` was not installed during this audit, so automatic nightly
execution and an operational 24-hour bound have not been established.

This is logical recovery using `pg_dump -Fc` / `pg_restore`; no WAL archiving or
PITR is configured. `--no-owner --no-acl` restores the schema and data without
recreating source role ownership, privileges or passwords. Count and sum cover
one key table and do not establish equality of every field in every table.
Local backups share the host's failure domain. Actual Infisical `dev` / `prod`
values were not inspected or changed.

The approach follows the lecturer's
[backup-verification theory](reference/node-js-pro/concepts/backup-verification.md),
[RTO/RPO explanation](reference/node-js-pro/concepts/rto-rpo.md) and
[step 8 drill](reference/node-js-pro/code/15_PoolingReplicasSharding/scripts/08-backup-drill.sh).
Our baseline is stored in the backup JSON from the same snapshot, rather than
queried later from a potentially changed source database.
