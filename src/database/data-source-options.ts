import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { validateDatabaseEnv } from '../config/database-env.schema';
import { RotationPool } from './rotation-pool';
import { rentalEntities } from './entities';

export function createDataSourceOptions(
  environment: Record<string, unknown> = process.env,
): PostgresConnectionOptions {
  const env = validateDatabaseEnv(environment);
  const passwordFile = env.DB_PASSWORD_FILE;
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    database: env.DB_NAME,
    password: passwordFile
      ? async () => {
          const password = (await readFile(passwordFile, 'utf8')).trim();
          if (!password) throw new Error('Database password file is empty');
          return password;
        }
      : env.DB_PASSWORD,
    ...(passwordFile ? { driver: { ...pg, Pool: RotationPool } } : {}),
    poolSize: 3,
    connectTimeoutMS: 3000,
    extra: { maxLifetimeSeconds: 300, idleTimeoutMillis: 10000 },
    // PostgreSQL 18 provides gen_random_uuid() natively; no extension installation is needed.
    uuidExtension: 'pgcrypto',
    installExtensions: false,
    entities: rentalEntities,
    migrations: [join(__dirname, '..', 'migrations', '*.js')],
    synchronize: false,
    migrationsRun: false,
  };
}
