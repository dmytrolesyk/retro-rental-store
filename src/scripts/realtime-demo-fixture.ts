import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../database/data-source-options';
import {
  Game,
  GameCopy,
  GamePlatform,
  Platform,
  Renter,
  GameCondition,
  PhysicalFormat,
} from '../database/entities';
import { configureApp } from '../configure-app';
import { RentalOutboxDispatcher } from '../outbox/rental-outbox.dispatcher';

/** Fresh disposable DB/API per CLI run. Never uses the developer's DB settings. */
export async function createRealtimeDemoFixture() {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('realtime_demo')
    .withUsername('realtime_demo')
    .withPassword(randomBytes(32).toString('hex'))
    .start();
  const renterId = randomUUID();
  const clientToken = randomBytes(32).toString('hex');
  const staffToken = randomBytes(32).toString('hex');
  const overrides = {
    DB_HOST: container.getHost(),
    DB_PORT: String(container.getPort()),
    DB_USER: container.getUsername(),
    DB_PASSWORD: container.getPassword(),
    DB_NAME: container.getDatabase(),
    DB_PASSWORD_FILE: undefined,
    AUTH_IDENTITIES: JSON.stringify([
      { id: randomUUID(), role: 'client', renterId, token: clientToken },
      { id: randomUUID(), role: 'staff', token: staffToken },
    ]),
    PORT: '3000',
    LOG_LEVEL: 'error',
    TIMEOUT_MS: '5000',
    RENTAL_DEADLINES_ENABLED: 'false',
    RENTAL_OUTBOX_ENABLED: 'true',
  };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  let migrationDataSource: DataSource | undefined;
  let app: INestApplication | undefined;
  const close = async (): Promise<void> => {
    try {
      await app?.close();
    } finally {
      try {
        if (migrationDataSource?.isInitialized) await migrationDataSource.destroy();
      } finally {
        try {
          await container.stop({ removeVolumes: true });
        } finally {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) Reflect.deleteProperty(process.env, key);
            else process.env[key] = value;
          }
        }
      }
    }
  };
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    migrationDataSource = new DataSource(createDataSourceOptions());
    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();
    await migrationDataSource.destroy();
    // AppModule validates environment on import; import only after isolated config is set.
    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    configureApp(app);
    const dataSource = app.get(DataSource);
    const gameId = randomUUID();
    const platformId = randomUUID();
    await dataSource.transaction(async manager => {
      await manager.insert(Renter, {
        renterId,
        name: 'Realtime demo owner',
        email: `${renterId}@example.test`,
        phoneNumber: renterId,
        balance: 10000,
      });
      await manager.insert(Game, {
        gameId,
        name: `Realtime demo ${gameId}`,
        nameUk: 'Realtime демо',
        description: 'Isolated realtime demo',
        descriptionUk: 'Ізольоване realtime демо',
      });
      await manager.insert(Platform, {
        platformId,
        name: `Realtime ${platformId}`,
        description: 'Isolated demo platform',
        descriptionUk: 'Платформа демо',
        releaseDate: '2000-01-01',
      });
      await manager.insert(GamePlatform, { gameId, platformId });
      await manager.insert(
        GameCopy,
        [0, 1].map(() => ({
          gameCopyId: randomUUID(),
          gameId,
          platformId,
          condition: GameCondition.Good,
          format: PhysicalFormat.Cartridge,
          pricePerDay: 2500,
        })),
      );
    });
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const book = async (): Promise<string> => {
      const response = await fetch(`${url}/rentals`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clientToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify({ renterId, gameId, platformId }),
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 201) throw new Error('Demo booking failed');
      const rental = (await response.json()) as { rentalId: string; status: string };
      if (typeof rental.rentalId !== 'string' || rental.status !== 'BOOKED')
        throw new Error('Invalid demo booking');
      return rental.rentalId;
    };
    const rentalA = await book();
    const rentalB = await book();
    // Drain setup publications before installing the clients under measurement.
    await app.get(RentalOutboxDispatcher).waitForIdle();
    return { url, clientToken, staffToken, rentalA, rentalB, close };
  } catch (error) {
    await close();
    throw error;
  }
}
