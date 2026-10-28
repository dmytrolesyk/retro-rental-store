import 'reflect-metadata';
import { access } from 'node:fs/promises';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Verifier } from '@pact-foundation/pact';
import { z } from 'zod';
import { configureApp } from '../../src/configure-app';
import {
  Game,
  GameCopy,
  GamePlatform,
  Platform,
  Rental,
  RentalItem,
  Renter,
} from '../../src/database/entities';
import { aCatalog, aRental, aRentalItem, aRenter } from '../integration/testkit/builders';
import { startPostgres } from '../integration/testkit/postgres';
import { PACT_FILE, PROVIDER_NAME, RENTAL_EXISTS_STATE } from './contract.config';

async function main(): Promise<void> {
  try {
    await access(PACT_FILE);
  } catch (error) {
    throw new Error('Local Pact is missing. Run pnpm test:consumer before pnpm verify:provider.', {
      cause: error,
    });
  }

  const kit = await startPostgres();
  let app: INestApplication | undefined;
  const overrides: Record<string, string | undefined> = {
    ...kit.environment,
    DB_PASSWORD_FILE: undefined,
    PORT: '3000',
    LOG_LEVEL: 'error',
    TIMEOUT_MS: '5000',
  };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    // Import only after setting DB env: ConfigModule validates it during module evaluation.
    const { AppModule } = await import('../../src/app.module.js');
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');

    const output = await new Verifier({
      provider: PROVIDER_NAME,
      providerBaseUrl: await app.getUrl(),
      pactUrls: [PACT_FILE],
      timeout: 60000,
      stateHandlers: {
        [RENTAL_EXISTS_STATE]: async parameters => {
          const { rentalId } = z.object({ rentalId: z.uuid() }).strict().parse(parameters);
          await kit.reset();
          const catalog = aCatalog();
          const renter = aRenter();
          // Fresh, committed fixture per state; no dependency on consumer example IDs/prices.
          await kit.dataSource.transaction(async manager => {
            await manager.getRepository(Game).save(catalog.game);
            await manager.getRepository(Platform).save(catalog.platform);
            await manager.getRepository(GamePlatform).save(catalog.gamePlatform);
            await manager.getRepository(GameCopy).save(catalog.copy);
            await manager.getRepository(Renter).save(renter);
            await manager.getRepository(Rental).save(aRental(renter.renterId, { rentalId }));
            await manager
              .getRepository(RentalItem)
              .save(aRentalItem(rentalId, catalog.copy.gameCopyId));
          });
        },
      },
      logLevel: 'warn',
    }).verifyProvider();
    console.log(output);
  } finally {
    try {
      await app?.close();
    } finally {
      try {
        await kit.stop();
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) Reflect.deleteProperty(process.env, key);
          else process.env[key] = value;
        }
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
