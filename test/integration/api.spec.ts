import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { CatalogController } from '../../src/catalog/catalog.controller';
import { CatalogService } from '../../src/catalog/catalog.service';
import { RentalsController } from '../../src/rentals/rentals.controller';
import { RentalsService } from '../../src/rentals/rentals.service';
import { RentalsRepository } from '../../src/rentals/rentals.repository';
import { CreateRentalResponseInterceptor } from '../../src/rentals/create-rental-response.interceptor';
import { configureApp } from '../../src/configure-app';
import { createApiDocument } from '../../src/openapi';
import {
  Game,
  GameCopy,
  GamePlatform,
  Platform,
  Rental,
  RentalItem,
  RentalJob,
  Renter,
} from '../../src/database/entities';
import { RentalRequest } from '../../src/rentals/entities/rental-request.entity';
import { aCatalog, aRental, aRenter } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';

interface CreatedRental {
  rentalId: string;
  gameCopyId: string;
  chargedAmount: number;
  balance: number;
}
interface Page {
  items: { gameId?: string; rentalId?: string }[];
  next_cursor: string | null;
}

describe('API contracts with real PostgreSQL', () => {
  let kit: PostgresTestkit;
  let app: INestApplication<App>;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    kit = await startPostgres();
    cleanup = () => kit.stop();
    // Focused HTTP boundary tests. Full AppModule E2E belongs to the next plan point.
    const module = await Test.createTestingModule({
      controllers: [CatalogController, RentalsController],
      providers: [
        CatalogService,
        RentalsService,
        RentalsRepository,
        CreateRentalResponseInterceptor,
        { provide: DataSource, useValue: kit.dataSource },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>({ logger: false });
    cleanup = async () => {
      try {
        await app.close();
      } finally {
        await kit.stop();
      }
    };
    configureApp(app);
    await app.init();
  });
  beforeEach(async () => {
    await kit.reset();
  });
  afterAll(async () => {
    await cleanup?.();
  });

  async function catalog() {
    const data = aCatalog();
    const db = kit.dataSource;
    await db.getRepository(Game).save(data.game);
    await db.getRepository(Platform).save(data.platform);
    await db.getRepository(GamePlatform).save(data.gamePlatform);
    await db.getRepository(GameCopy).save(data.copy);
    return data;
  }
  async function fixture() {
    const data = await catalog();
    const renter = await kit.dataSource.getRepository(Renter).save(aRenter());
    return {
      renter,
      data,
      input: {
        renterId: renter.renterId,
        gameId: data.game.gameId,
        platformId: data.platform.platformId,
      },
    };
  }
  const post = () => request(app.getHttpServer()).post('/rentals');

  it('creates and reads a rental with a stable public response', async () => {
    const { input, data } = await fixture();
    const result = await post().set('Idempotency-Key', 'create-0001').send(input).expect(201);
    const body = result.body as CreatedRental;
    expect(body.rentalId).toEqual(expect.any(String));
    expect(body).toEqual({
      rentalId: body.rentalId,
      gameCopyId: data.copy.gameCopyId,
      chargedAmount: 2500,
      balance: 7500,
    });
    expect(result.get('Location')).toBe(`/rentals/${body.rentalId}`);
    expect(result.get('Idempotency-Replay')).toBe('false');
    const read = await request(app.getHttpServer()).get(`/rentals/${body.rentalId}`).expect(200);
    expect(read.body).toMatchObject({
      rentalId: body.rentalId,
      renterId: input.renterId,
      items: [{ gameCopyId: body.gameCopyId, costPerDay: 2500, returnedAt: null }],
    });
  });

  it('replays concurrent retries once and persists the response across service instances', async () => {
    const { input } = await fixture();
    const results = await Promise.all([
      post().set('Idempotency-Key', 'parallel-0001').send(input),
      post().set('Idempotency-Key', 'parallel-0001').send(input),
    ]);
    expect(results.map(result => result.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    expect(results.map(result => result.get('Idempotency-Replay')).sort()).toEqual([
      'false',
      'true',
    ]);
    const replay = await new RentalsService(
      kit.dataSource,
      new RentalsRepository(kit.dataSource),
    ).create(input, 'parallel-0001');
    expect(replay).toEqual({ response: results[0].body as CreatedRental, replayed: true });
    for (const table of [Rental, RentalItem, RentalJob, RentalRequest]) {
      await expect(kit.dataSource.getRepository(table).count()).resolves.toBe(1);
    }
    await expect(
      kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: input.renterId }),
    ).resolves.toMatchObject({ balance: 7500 });
  });

  it('ignores JSON property order and UUID case but rejects a different validated body', async () => {
    const { input } = await fixture();
    const first = await post().set('Idempotency-Key', 'same-body-0001').send(input).expect(201);
    const second = await post()
      .set('Idempotency-Key', 'same-body-0001')
      .send({
        platformId: input.platformId.toUpperCase(),
        gameId: input.gameId,
        renterId: input.renterId,
      })
      .expect(201);
    expect(second.body).toEqual(first.body);
    expect(second.get('Location')).toBe(first.get('Location'));
    expect(second.get('Idempotency-Replay')).toBe('true');
    const conflict = await post()
      .set('Idempotency-Key', 'same-body-0001')
      .send({ ...input, gameId: randomUUID() })
      .expect(422);
    expect(conflict.get('Content-Type')).toMatch(/application\/problem\+json/);
    await expect(kit.dataSource.getRepository(Rental).count()).resolves.toBe(1);
  });

  it('accepts only one of two concurrent different bodies for the same key', async () => {
    const { input } = await fixture();
    const other = await catalog();
    const results = await Promise.all([
      post().set('Idempotency-Key', 'different-race-0001').send(input),
      post()
        .set('Idempotency-Key', 'different-race-0001')
        .send({
          ...input,
          gameId: other.game.gameId,
          platformId: other.platform.platformId,
        }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([201, 422]);
    for (const table of [Rental, RentalItem, RentalJob, RentalRequest]) {
      await expect(kit.dataSource.getRepository(table).count()).resolves.toBe(1);
    }
    await expect(
      kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: input.renterId }),
    ).resolves.toMatchObject({ balance: 7500 });
  });

  it('rolls back the key, rental, job and debit if storing the response fails', async () => {
    const { input } = await fixture();
    await kit.dataSource.query(
      `CREATE FUNCTION public.fail_test_response() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected storage failure'; END $$`,
    );
    await kit.dataSource.query(
      `CREATE TRIGGER fail_test_response BEFORE UPDATE ON rental_requests FOR EACH ROW EXECUTE FUNCTION public.fail_test_response()`,
    );
    try {
      const failure = await post()
        .set('Idempotency-Key', 'storage-failure-0001')
        .send(input)
        .expect(500);
      expect(failure.body).toMatchObject({ status: 500, detail: 'Internal server error' });
      expect(JSON.stringify(failure.body)).not.toContain('Injected');
      for (const table of [Rental, RentalItem, RentalJob, RentalRequest]) {
        await expect(kit.dataSource.getRepository(table).count()).resolves.toBe(0);
      }
      await expect(
        kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: input.renterId }),
      ).resolves.toMatchObject({ balance: 10000 });
    } finally {
      await kit.dataSource.query('DROP TRIGGER fail_test_response ON rental_requests');
      await kit.dataSource.query('DROP FUNCTION public.fail_test_response()');
    }
    await post().set('Idempotency-Key', 'storage-failure-0001').send(input).expect(201);
  });

  it('rolls back a failed checkout so the same key can be retried after replenishing balance', async () => {
    const { input } = await fixture();
    await kit.dataSource.getRepository(Renter).update(input.renterId, { balance: 0 });
    await post().set('Idempotency-Key', 'balance-retry-0001').send(input).expect(409);
    await expect(kit.dataSource.getRepository(RentalRequest).count()).resolves.toBe(0);
    await kit.dataSource.getRepository(Renter).update(input.renterId, { balance: 10000 });
    await post().set('Idempotency-Key', 'balance-retry-0001').send(input).expect(201);
    await post().set('Idempotency-Key', 'copy-taken-0001').send(input).expect(409);
  });

  it('validates body and required headers before creating side effects', async () => {
    const { input } = await fixture();
    await post().send(input).expect(400);
    await post()
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'malformed-json-0001')
      .send('{broken')
      .expect(400);
    await post().set('Idempotency-Key', 'bad key with spaces').send(input).expect(400);
    await post()
      .set('Idempotency-Key', 'invalid-body-0001')
      .send({ ...input, renterId: 'invalid' })
      .expect(400);
    await post()
      .set('Idempotency-Key', 'invalid-body-0001')
      .send({ ...input, extra: true })
      .expect(400);
    for (const body of [
      { gameId: input.gameId, platformId: input.platformId },
      { ...input, renterId: null },
      { ...input, gameId: 123 },
      { ...input, platformId: [input.platformId] },
      [input],
    ]) {
      const result = await post().set('Idempotency-Key', 'invalid-dto-0001').send(body).expect(400);
      expect(result.get('Content-Type')).toMatch(/application\/problem\+json/);
    }
    for (const key of ['short', 'x'.repeat(129)]) {
      await post().set('Idempotency-Key', key).send(input).expect(400);
    }
    await expect(kit.dataSource.getRepository(Rental).count()).resolves.toBe(0);
    await expect(kit.dataSource.getRepository(RentalRequest).count()).resolves.toBe(0);
  });

  it.each([8, 128])('accepts an idempotency key of exactly %i characters', async length => {
    const { input } = await fixture();
    await post().set('Idempotency-Key', 'x'.repeat(length)).send(input).expect(201);
  });

  it('returns consistent problem details for malformed and missing resources', async () => {
    for (const [path, status] of [
      [`/games/${randomUUID()}`, 404],
      [`/rentals/${randomUUID()}`, 404],
      ['/rentals/not-a-uuid', 400],
      ['/unknown', 404],
    ] as const) {
      const result = await request(app.getHttpServer()).get(path).expect(status);
      expect(result.get('Content-Type')).toMatch(/application\/problem\+json/);
      expect(result.body).toMatchObject({ status, instance: path });
      for (const field of ['type', 'title', 'detail']) {
        expect(result.body).toHaveProperty(field, expect.any(String));
      }
    }
    const { input } = await fixture();
    await post()
      .set('Idempotency-Key', 'no-renter-0001')
      .send({ ...input, renterId: randomUUID() })
      .expect(404);
  });

  it('paginates games without duplicates and serves game details with platform IDs', async () => {
    const data = await Promise.all([catalog(), catalog(), catalog()]);
    const one = await request(app.getHttpServer()).get('/games?limit=2').expect(200);
    const first = one.body as Page;
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const two = await request(app.getHttpServer())
      .get('/games')
      .query({ limit: 2, cursor: first.next_cursor })
      .expect(200);
    const second = two.body as Page;
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    expect([...first.items, ...second.items].map(item => item.gameId)).toEqual(
      data.map(item => item.game.gameId).sort(),
    );
    const game = data[0];
    const detail = await request(app.getHttpServer()).get(`/games/${game.game.gameId}`).expect(200);
    expect(detail.body).toMatchObject({
      gameId: game.game.gameId,
      platforms: [{ platformId: game.platform.platformId, name: game.platform.name }],
    });
    await request(app.getHttpServer())
      .get('/rentals')
      .query({ cursor: first.next_cursor })
      .expect(400);
  });

  it('paginates rentals and returns an empty terminal page', async () => {
    await request(app.getHttpServer())
      .get('/rentals')
      .expect(200, { items: [], next_cursor: null });
    const renter = await kit.dataSource.getRepository(Renter).save(aRenter());
    const rentals = await kit.dataSource
      .getRepository(Rental)
      .save([aRental(renter.renterId), aRental(renter.renterId), aRental(renter.renterId)]);
    const one = await request(app.getHttpServer()).get('/rentals?limit=2').expect(200);
    const first = one.body as Page;
    const two = await request(app.getHttpServer())
      .get('/rentals')
      .query({ limit: 2, cursor: first.next_cursor })
      .expect(200);
    const second = two.body as Page;
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    expect([...first.items, ...second.items].map(item => item.rentalId)).toEqual(
      rentals.map(item => item.rentalId).sort(),
    );
  });

  it.each([
    'limit=0',
    'limit=101',
    'limit=nope',
    'limit=1&limit=2',
    'limit=1e2',
    'limit=01',
    'limit=1.5',
    'limit=%202',
    'limit=',
    'cursor=',
    'cursor=a&cursor=b',
    'cursor=garbage',
    'extra=1',
  ])('rejects invalid pagination: %s', async query => {
    await request(app.getHttpServer()).get(`/games?${query}`).expect(400);
  });

  it('publishes exactly five documented operations with required idempotency and problem media types', () => {
    const spec = createApiDocument(app);
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/games',
      '/games/{gameId}',
      '/rentals',
      '/rentals/{rentalId}',
    ]);
    const operations = Object.values(spec.paths).flatMap(path =>
      [path.get, path.post].filter(operation => operation !== undefined),
    );
    expect(operations).toHaveLength(5);
    for (const operation of operations) {
      expect(operation.operationId).toEqual(expect.any(String));
      expect(operation.summary).toEqual(expect.any(String));
    }
    const create = spec.paths['/rentals'].post;
    if (!create) throw new Error('Missing POST /rentals contract');
    expect(create.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', in: 'header', required: true }),
      ]),
    );
    expect(create.responses['422']).toHaveProperty('content.application/problem+json');
    expect(create.responses['201']).toHaveProperty(
      'content.application/json.schema.$ref',
      '#/components/schemas/CreatedRentalDto',
    );
    const problem = spec.components?.schemas?.Problem;
    if (!problem || '$ref' in problem) throw new Error('Missing required Problem schema');
    expect(problem.required).toEqual(['type', 'title', 'status', 'detail', 'instance']);
    expect(spec.openapi).toMatch(/^3\.0\./);
  });
});
