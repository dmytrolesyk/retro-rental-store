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

All environment variables are validated at startup by a single zod schema
([src/config/env.schema.ts](src/config/env.schema.ts)) via `validate` in
`ConfigModule.forRoot` — a broken or missing variable stops the process with
exit code ≠ 0 and the list of every invalid variable. The rest of the code
only reads config through the typed `ConfigService<Env, true>`.

| Variable           | Required | Default | Source                   | Description                                                     |
| ------------------ | -------- | ------- | ------------------------ | --------------------------------------------------------------- |
| `PORT`             | yes      | —       | Environment              | HTTP port the API listens on                                    |
| `PG_HOST`          | yes      | —       | Environment              | Postgres host (`db` inside compose, `127.0.0.1` for local runs) |
| `PG_PORT`          | no       | `5432`  | Environment              | Postgres port                                                   |
| `PG_USER`          | yes      | —       | Environment              | Application DB role (least-privilege, not the admin)            |
| `PG_DB`            | yes      | —       | Environment              | Database name                                                   |
| `PG_PASSWORD_FILE` | yes      | —       | Credentials volume       | Path to the file holding the app user's password                |
| `LOG_LEVEL`        | no       | `info`  | Environment              | `debug` \| `info` \| `warn` \| `error`                          |
| `TIMEOUT_MS`       | no       | `5000`  | Environment              | Generic operation timeout, ms                                   |

`.env.example` is the contract kept in git; the real `.env` is gitignored and
excluded from the docker image. `pnpm check:env` verifies `.env.example`
against the schema (missing or invalid variables → exit 1).

### Running

Start PostgreSQL and the automatic password rotator:

```bash
docker compose up -d --wait
```

No `.env` or host-side secret files are required. The one-shot `init-secrets`
service generates the `app_user` password in the `app_credentials` named
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
Compose supplies the API's existing `PG_*` configuration directly.

This homework uses the new `data_typeorm` database volume. The previous
homework's `data_sql` volume is retained. Keep `data_typeorm` and
`app_credentials` together: deleting only the credentials volume generates
a password that no longer matches the existing database role.

### Database roles

| Role | Purpose | Credentials |
| ---- | ------- | ----------- |
| `admin` | Local database initialization and password rotation | Dev password `admin_dev` |
| `migration_user` | Host-side migrations, seed, demos and reports | Dev password `migration_dev` |
| `app_user` | API queries; no schema creation privileges | Generated password, rotated automatically |

`migration_user` can create objects in `public` and install trusted
extensions in the development database. Default privileges give `app_user`
SELECT/INSERT/UPDATE/DELETE on tables and USAGE/SELECT on sequences created
by `migration_user`. Docker initialization creates roles and grants only;
application tables will be created by TypeORM migrations.

### Password rotation (no API restart)

The API re-reads `PG_PASSWORD_FILE` whenever its `pg.Pool` creates a new
connection. The rotator changes the `app_user` password in PostgreSQL,
atomically replaces the password file, then terminates `app_user`
connections. Migration and admin passwords are unchanged.

```bash
./scripts/rotate.sh   # one-shot rotation through the running rotator
```

Scheduled and manual rotations share a file lock, so they cannot overlap.
The automatic interval is `ROTATE_INTERVAL` seconds (default `86400`):

```bash
ROTATE_INTERVAL=60 pnpm compose:up
```

The API process stays up, but terminating connections can interrupt active
queries or transactions. This educational mechanism demonstrates reconnecting;
it does not guarantee uninterrupted requests. Changing the database password
and publishing the file are separate operations, so a crash between them
requires recovery.

## Grading

Infisical is optional for this homework as agreed with the teacher. Use pnpm
and these fixed local development credentials; no vault wrapper or
`SKIP_VAULT` is needed:

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=migration_user DB_PASSWORD=migration_dev DB_NAME=rental
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run build
```

If port `5432` is already occupied, export an available `DB_PORT` before
starting Compose and use the same value for the host-side connection.
The TypeORM commands will be documented as they are added in subsequent steps.

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
docker compose exec db psql -U admin -d rental
```

For DBeaver, use host `localhost`, port `55432`, database `rental`, user
`admin`, and the local dev password `admin_dev`.

For a non-interactive connection check, run:

```bash
docker compose exec -T db psql -U admin -d rental -Atc 'SELECT 1'
```

### Create and seed the database

Apply the schema to an empty database:

```bash
docker compose exec -T db \
  psql -U admin -d rental -v ON_ERROR_STOP=1 \
  < db/schema.sql
```

Load the fixture and generated benchmark data:

```bash
./scripts/seed.sh db/seed-benchmark.sql
```

The seed finishes with `VACUUM (ANALYZE)`. Verify the two required table sizes:

```bash
docker compose exec -T db psql -U admin -d rental -c \
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
  psql -U admin -d rental -v ON_ERROR_STOP=1 \
  < db/indexes.sql
docker compose exec -T db psql -U admin -d rental -c 'ANALYZE;'
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

This project retains the connection design from homework 11 instead of using a
single `DB_URL`. `PG_HOST`, `PG_PORT`, `PG_USER`, and `PG_DB` describe the
connection, while `PG_PASSWORD_FILE` points to the Docker/deployment secret.
The generated app_user password is never committed or stored in a tracked
environment file, and the pool rereads it when opening a connection so rotation
does not require an application restart.

> **Previous PostgreSQL homework compatibility note:** Its acceptance example checks for a
> single `DB_URL` or `DATABASE_URL`. This project deliberately keeps the
> equivalent split connection contract from homework 11 so that the password
> can remain in a separately mounted, rotatable secret instead of being
> embedded in a connection URL.

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
