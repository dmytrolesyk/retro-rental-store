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
# After entities are added, generate against a database with all existing migrations applied:
pnpm run migration:generate src/migrations/InitialRentalSchema
pnpm run build # compile the generated migration before running it
```

Export the CLI credentials from the Grading block before these commands.
`synchronize: false` and `migrationsRun: false` prevent schema changes on API
startup. All nine entities are registered; migration files are added in the next step.
`migrate:show` currently has no migration entries. Only the CLI module exports a
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
After building, `pnpm run migrate:show` checks the CLI connection.
Migration files are added in the migration step.

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

The next migration step also carries over both functions and triggers from
`db/schema.sql`: `check_rental_returned_at` / `rental_items_returned_at_check`
and `check_rental_rented_at` / `rentals_rented_at_check`.
Entities alone do not install these objects or create the business tables.

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
