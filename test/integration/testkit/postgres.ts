import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../../../src/database/data-source-options';

export interface PostgresTestkit {
  dataSource: DataSource;
  environment: Record<string, string>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/** One disposable database per suite; never reads the developer's DB_* settings. */
export async function startPostgres(): Promise<PostgresTestkit> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('rental_test')
    .withUsername('rental_test')
    .withPassword(randomUUID())
    .start();
  const environment = {
    DB_HOST: container.getHost(),
    DB_PORT: String(container.getPort()),
    DB_USER: container.getUsername(),
    DB_PASSWORD: container.getPassword(),
    DB_NAME: container.getDatabase(),
  };
  let dataSource: DataSource | undefined;

  async function stop(): Promise<void> {
    try {
      if (dataSource?.isInitialized) await dataSource.destroy();
    } finally {
      await container.stop({ removeVolumes: true });
    }
  }

  try {
    dataSource = new DataSource(createDataSourceOptions(environment));
    await dataSource.initialize();
    await dataSource.runMigrations();
    const db = dataSource;
    return {
      dataSource: db,
      environment,
      async reset() {
        // Only mapped application tables; retain TypeORM's migration history.
        const tables = db.entityMetadatas.map(
          metadata => `"public".${db.driver.escape(metadata.tableName)}`,
        );
        await db.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
      },
      stop,
    };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Test database setup and cleanup failed');
    }
    throw error;
  }
}
