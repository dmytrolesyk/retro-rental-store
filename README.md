<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

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
| `DB_HOST` | yes | `db` inside Compose, `127.0.0.1` from the host |
| `DB_PORT` | no, default `5432` | Connection port; also the published host port in Compose |
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

Start PostgreSQL and the automatic password rotator:

```bash
docker compose up -d --wait
```

No `.env` or host-side secret files are required. The one-shot `init-secrets`
service generates the `db_app` password in the `app_credentials` named
volume before PostgreSQL starts. Existing passwords are kept on subsequent
runs. PostgreSQL and the API mount this volume read-only; the init service
and rotator can write to it.

To also build and start the API, enable the `app` profile:

```bash
pnpm compose:up   # docker compose --profile app up -d --build --wait
pnpm compose:down
```

The API uses `db:5432` inside Compose. Host-side scripts use `127.0.0.1`
and the published port, selected by `DB_PORT` (default `5432`).
Compose supplies the API's `DB_*` configuration directly.

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

`db_migrator` can create objects in `public` and install trusted
extensions in the development database. Default privileges give `db_app`
SELECT/INSERT/UPDATE/DELETE on tables and USAGE/SELECT on sequences created
by `db_migrator`. Docker initialization creates roles and grants only;
application tables will be created by TypeORM migrations.

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
on PostgreSQL authentication error `28P01`: four attempts total, with waits
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
(with an available `DB_PORT`). Use the same project name for subsequent commands.
Old role names can be retained through the role-specific Compose overrides,
but an old credentials volume also needs its password file migrated explicitly.

## Grading

Infisical is optional for this homework as agreed with the teacher. Use pnpm
and these fixed local development credentials; no vault wrapper or
`SKIP_VAULT` is needed:

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=db_migrator DB_PASSWORD=migration_dev DB_NAME=rental
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run build
```

If port `5432` is already occupied, export an available `DB_PORT` before
starting Compose and use the same value for the host-side connection.
Apply and verify the initial schema:

```bash
pnpm run migrate
pnpm run migrate:show
```

`migrate:show` should list `[X] InitialRentalSchema1791301576818`
(the output also includes its journal ID).
On a disposable database, check rollback and reapplication:

```bash
pnpm run migrate:revert
pnpm run migrate
```

Then seed twice and verify the counts with the command in the ORM seed section:

```bash
pnpm run seed
pnpm run seed
pnpm run demo:nplus1
```

## ORM seed

After exporting the CLI credentials from `Grading`, building and applying
migrations, run `pnpm run seed`. The standalone script uses the shared
DataSource without starting Nest or an HTTP server.

The entire checked-in Retronian catalog is imported offline from
`db/fixtures/retronian/*.tsv`: its UUIDs, text, dates and relations are preserved.
`csv-parse` handles CSV quoting with a tab delimiter; Zod validates the input,
and PostgreSQL `\\N` fixture markers become `null`. The data attribution and
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
`pricePerDayKopecks` and `costPerDayKopecks`. Both retain a `CHECK >= 0`.
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

## Catalog data

After applying `db/schema.sql` to an empty database, run `./scripts/seed.sh`
to import only the real Retronian catalog: games, platforms, genres, and their
relationships. Physical copies, renters, and rental history start empty.
Apply `db/indexes.sql` to enable the application indexes.

The previous homework dataset is preserved in `db/seed-benchmark.sql`.
To reproduce its measurements, use the workflow below on an empty database.
Neither seed is intended to be run twice on an already seeded database.

## PostgreSQL homework workflow

Run every command in this section from the repository root. The main benchmark
table is `rentals` (100,000 seeded rows), and the Q4 catalog-search table is
`games` (100,000 seeded rows).

### Start and connect

A fresh clone needs no manually created credential files. This one command
initializes the credentials volume and starts PostgreSQL:

```bash
export DB_PORT=55432 && docker compose up -d --build --wait db
```

`DB_PORT` selects the host port; PostgreSQL continues to listen on its standard
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

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
