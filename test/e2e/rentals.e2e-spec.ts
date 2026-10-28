import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../../src/configure-app';
import {
  Game,
  GameCopy,
  GamePlatform,
  Platform,
  Rental,
  Renter,
} from '../../src/database/entities';
import type { CreatedRentalDto } from '../../src/rentals/rentals.dto';
import { aCatalog, aRenter } from '../integration/testkit/builders';
import { startPostgres } from '../integration/testkit/postgres';
import type { PostgresTestkit } from '../integration/testkit/postgres';

function expectProblem(response: Response, status: number, path: string): void {
  expect(response.get('Content-Type')).toMatch(/application\/problem\+json/);
  expect(response.body).toMatchObject({ status, instance: path });
  for (const field of ['type', 'title', 'detail']) {
    expect(response.body).toHaveProperty(field, expect.any(String));
  }
}

describe('Rental HTTP API (full AppModule)', () => {
  let kit: PostgresTestkit;
  let app: INestApplication<App>;
  let closeApplication: (() => Promise<void>) | undefined;
  let stopPostgres: (() => Promise<void>) | undefined;
  let restoreEnvironment: (() => void) | undefined;

  beforeAll(async () => {
    kit = await startPostgres();
    stopPostgres = () => kit.stop();
    const overrides: Record<string, string | undefined> = {
      ...kit.environment,
      DB_PASSWORD_FILE: undefined,
      PORT: '3000',
      LOG_LEVEL: 'error',
      TIMEOUT_MS: '5000',
    };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    restoreEnvironment = () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }

    // ConfigModule.forRoot validates env when AppModule is imported, before compile().
    const { AppModule } =
      jest.requireActual<typeof import('../../src/app.module')>('../../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    closeApplication = () => module.close();
    app = module.createNestApplication<INestApplication<App>>({ logger: false });
    closeApplication = () => app.close();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await kit.reset();
  });

  afterAll(async () => {
    try {
      await closeApplication?.();
    } finally {
      try {
        await stopPostgres?.();
      } finally {
        restoreEnvironment?.();
      }
    }
  });

  async function fixture() {
    const data = aCatalog();
    const db = kit.dataSource;
    await db.getRepository(Game).save(data.game);
    await db.getRepository(Platform).save(data.platform);
    await db.getRepository(GamePlatform).save(data.gamePlatform);
    await db.getRepository(GameCopy).save(data.copy);
    const renter = await db.getRepository(Renter).save(aRenter());
    return {
      data,
      renter,
      input: {
        renterId: renter.renterId,
        gameId: data.game.gameId,
        platformId: data.platform.platformId,
      },
    };
  }

  it('creates a rental over HTTP and reads it from its Location', async () => {
    const { data, renter, input } = await fixture();
    const result = await request(app.getHttpServer())
      .post('/rentals')
      .set('Idempotency-Key', `e2e-${randomUUID()}`)
      .send(input)
      .expect(201);
    const created = result.body as CreatedRentalDto;
    expect(created.rentalId).toEqual(expect.any(String));
    expect(created).toEqual({
      rentalId: created.rentalId,
      gameCopyId: data.copy.gameCopyId,
      chargedAmount: data.copy.pricePerDay,
      balance: renter.balance - data.copy.pricePerDay,
    });
    const location = result.get('Location');
    expect(location).toBe(`/rentals/${created.rentalId}`);
    if (!location) throw new Error('POST /rentals did not return Location');
    expect(result.get('Idempotency-Replay')).toBe('false');

    // Fixture/migration pool reads effects committed by AppModule's own connection pool.
    const stored = await kit.dataSource.getRepository(Rental).findOneByOrFail({
      rentalId: created.rentalId,
    });
    const read = await request(app.getHttpServer()).get(location).expect(200);
    expect(read.body).toEqual({
      rentalId: created.rentalId,
      renterId: renter.renterId,
      rentedAt: stored.rentedAt.toISOString(),
      items: [
        { gameCopyId: data.copy.gameCopyId, costPerDay: data.copy.pricePerDay, returnedAt: null },
      ],
    });
    await expect(
      kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: renter.renterId }),
    ).resolves.toMatchObject({ balance: created.balance });
  });

  it('returns problem details with 404 for a valid UUID without a rental', async () => {
    const path = `/rentals/${randomUUID()}`;
    const result = await request(app.getHttpServer()).get(path).expect(404);
    expectProblem(result, 404, path);
  });

  it('returns problem details with 400 for a malformed rental UUID', async () => {
    const path = '/rentals/not-a-uuid';
    const result = await request(app.getHttpServer()).get(path).expect(400);
    expectProblem(result, 400, path);
  });

  it('validates body and headers through the shared application configuration', async () => {
    const { input, renter } = await fixture();
    const missingKey = await request(app.getHttpServer()).post('/rentals').send(input).expect(400);
    expectProblem(missingKey, 400, '/rentals');
    const unknownField = await request(app.getHttpServer())
      .post('/rentals')
      .set('Idempotency-Key', `e2e-${randomUUID()}`)
      .send({ ...input, extra: true })
      .expect(400);
    expectProblem(unknownField, 400, '/rentals');
    await expect(kit.dataSource.getRepository(Rental).count()).resolves.toBe(0);
    await expect(
      kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: renter.renterId }),
    ).resolves.toMatchObject({ balance: renter.balance });
  });
});
