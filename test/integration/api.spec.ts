import { AuthModule } from '../../src/auth/auth.module';
import { AUTH_IDENTITIES } from '../../src/auth/auth.config';
import {
  clientPrincipal,
  otherPrincipal,
  testIdentities,
  clientAuthorization,
  otherAuthorization,
  staffAuthorization,
} from './testkit/auth';
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
import { IssueRental } from '../../src/rentals/use-cases/issue-rental';
import { CancelRental } from '../../src/rentals/use-cases/cancel-rental';
import { ReturnRental } from '../../src/rentals/use-cases/return-rental';
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
  status: 'BOOKED';
  bookedAt: string;
  bookingExpiresAt: string;
  costPerDay: number;
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
      imports: [AuthModule],
      controllers: [CatalogController, RentalsController],
      providers: [
        CatalogService,
        RentalsService,
        IssueRental,
        CancelRental,
        ReturnRental,
        RentalsRepository,
        CreateRentalResponseInterceptor,
        { provide: DataSource, useValue: kit.dataSource },
      ],
    })
      .overrideProvider(AUTH_IDENTITIES)
      .useValue(testIdentities)
      .compile();
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
    const catalogFixture = aCatalog();
    const dataSource = kit.dataSource;
    await dataSource.getRepository(Game).save(catalogFixture.game);
    await dataSource.getRepository(Platform).save(catalogFixture.platform);
    await dataSource.getRepository(GamePlatform).save(catalogFixture.gamePlatform);
    await dataSource.getRepository(GameCopy).save(catalogFixture.copy);
    return catalogFixture;
  }
  async function fixture() {
    const catalogFixture = await catalog();
    const renter = await kit.dataSource
      .getRepository(Renter)
      .save(aRenter({ renterId: clientPrincipal.renterId }));
    return {
      renter,
      catalogFixture,
      input: {
        renterId: renter.renterId,
        gameId: catalogFixture.game.gameId,
        platformId: catalogFixture.platform.platformId,
      },
    };
  }
  const post = () =>
    request(app.getHttpServer()).post('/rentals').set('Authorization', clientAuthorization);

  it.each([undefined, 'Basic abc', 'Bearer invalid', `Bearer ${'x'.repeat(64)}`])(
    'rejects missing, malformed or unknown credentials before reading rentals',
    async authorization => {
      const call = request(app.getHttpServer()).get('/rentals');
      if (authorization) call.set('Authorization', authorization);
      const response = await call.expect(401);
      expect(response.get('WWW-Authenticate')).toBe('Bearer');
      expect(response.get('Content-Type')).toMatch(/application\/problem\+json/);
      expect(JSON.stringify(response.body)).not.toContain(testIdentities[0].token);
    },
  );

  it('rejects duplicate Authorization headers instead of choosing one identity', async () => {
    await request(app.getHttpServer())
      .get('/rentals')
      .set({ Authorization: [clientAuthorization, staffAuthorization] })
      .expect(401);
  });

  it('allows owner and staff reads, but refuses another client', async () => {
    const renter = await kit.dataSource
      .getRepository(Renter)
      .save(aRenter({ renterId: clientPrincipal.renterId }));
    const rental = await kit.dataSource.getRepository(Rental).save(aRental(renter.renterId));
    const path = `/rentals/${rental.rentalId}`;
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', clientAuthorization)
      .expect(200);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', staffAuthorization)
      .expect(200);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', otherAuthorization)
      .expect(403);
  });

  it('scopes every client page in SQL before pagination, even with another client cursor', async () => {
    const dataSource = kit.dataSource;
    for (const actor of [clientPrincipal, otherPrincipal]) {
      await dataSource.getRepository(Renter).save(aRenter({ renterId: actor.renterId }));
      await dataSource
        .getRepository(Rental)
        .save(Array.from({ length: 3 }, () => aRental(actor.renterId)));
    }
    let cursor: string | null = null;
    const seen: string[] = [];
    do {
      const response = await request(app.getHttpServer())
        .get('/rentals')
        .set('Authorization', clientAuthorization)
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
        .expect(200);
      const page = response.body as {
        items: { rentalId: string; renterId: string }[];
        next_cursor: string | null;
      };
      expect(page.items).toHaveLength(1);
      expect(page.items[0].renterId).toBe(clientPrincipal.renterId);
      seen.push(page.items[0].rentalId);
      cursor = page.next_cursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(3);
    const other = await request(app.getHttpServer())
      .get('/rentals?limit=1')
      .set('Authorization', otherAuthorization)
      .expect(200);
    const foreignCursor = (other.body as Page).next_cursor;
    const response = await request(app.getHttpServer())
      .get('/rentals')
      .set('Authorization', clientAuthorization)
      .query({ limit: 100, cursor: foreignCursor })
      .expect(200);
    const page = response.body as { items: { renterId: string }[] };
    expect(page.items.every(item => item.renterId === clientPrincipal.renterId)).toBe(true);
  });

  it('rejects owner/role spoofing before idempotency, payment or rental writes', async () => {
    const { input } = await fixture();
    await post()
      .set('Idempotency-Key', 'foreign-owner-0001')
      .send({ ...input, renterId: otherPrincipal.renterId })
      .expect(403);
    await request(app.getHttpServer())
      .post('/rentals')
      .set('Authorization', staffAuthorization)
      .set('Idempotency-Key', 'staff-create-0001')
      .send(input)
      .expect(403);
    await post()
      .set('Idempotency-Key', 'forged-role-0001')
      .send({ ...input, role: 'staff' })
      .expect(400);
    for (const table of [Rental, RentalItem, RentalJob, RentalRequest]) {
      expect(await kit.dataSource.getRepository(table).count()).toBe(0);
    }
    expect(
      (await kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: input.renterId }))
        .balance,
    ).toBe(10000);
  });

  it('creates and reads a rental with a stable public response', async () => {
    const { input, catalogFixture } = await fixture();
    const response = await post().set('Idempotency-Key', 'create-0001').send(input).expect(201);
    const body = response.body as CreatedRental;
    expect(body.rentalId).toEqual(expect.any(String));
    expect(body.bookedAt).toEqual(expect.any(String));
    expect(body.bookingExpiresAt).toEqual(expect.any(String));
    expect(body).toEqual({
      rentalId: body.rentalId,
      gameCopyId: catalogFixture.copy.gameCopyId,
      status: 'BOOKED',
      costPerDay: 2500,
      bookedAt: body.bookedAt,
      bookingExpiresAt: body.bookingExpiresAt,
    });
    expect(response.get('Location')).toBe(`/rentals/${body.rentalId}`);
    expect(response.get('Idempotency-Replay')).toBe('false');
    const read = await request(app.getHttpServer())
      .get(`/rentals/${body.rentalId}`)
      .set('Authorization', staffAuthorization)
      .expect(200);
    expect(read.body).toMatchObject({
      rentalId: body.rentalId,
      renterId: input.renterId,
      items: [{ gameCopyId: body.gameCopyId, costPerDay: 2500, returnedAt: null }],
    });
  });

  it('replays concurrent retries once and persists the response across service instances', async () => {
    const { input } = await fixture();
    const responses = await Promise.all([
      post().set('Idempotency-Key', 'parallel-0001').send(input),
      post().set('Idempotency-Key', 'parallel-0001').send(input),
    ]);
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses.map(response => response.get('Idempotency-Replay')).sort()).toEqual([
      'false',
      'true',
    ]);
    const replay = await new RentalsService(
      kit.dataSource,
      new RentalsRepository(kit.dataSource),
    ).create(input, 'parallel-0001', clientPrincipal);
    expect(replay).toEqual({ response: responses[0].body as CreatedRental, replayed: true });
    for (const table of [Rental, RentalItem, RentalRequest]) {
      await expect(kit.dataSource.getRepository(table).count()).resolves.toBe(1);
    }
    await expect(
      kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: input.renterId }),
    ).resolves.toMatchObject({ balance: 10000 });
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
    const responses = await Promise.all([
      post().set('Idempotency-Key', 'different-race-0001').send(input),
      post()
        .set('Idempotency-Key', 'different-race-0001')
        .send({
          ...input,
          gameId: other.game.gameId,
          platformId: other.platform.platformId,
        }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 422]);
    for (const table of [Rental, RentalItem, RentalRequest]) {
      await expect(kit.dataSource.getRepository(table).count()).resolves.toBe(1);
    }
    await expect(
      kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: input.renterId }),
    ).resolves.toMatchObject({ balance: 10000 });
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

  it('does not reserve a failed booking key and retries after the copy is released', async () => {
    const { input } = await fixture();
    const first = await post().set('Idempotency-Key', 'first-booking-0001').send(input).expect(201);
    await post().set('Idempotency-Key', 'booking-retry-0001').send(input).expect(409);
    await expect(kit.dataSource.getRepository(RentalRequest).count()).resolves.toBe(1);
    await request(app.getHttpServer())
      .post(`/rentals/${(first.body as CreatedRental).rentalId}/cancel`)
      .set('Authorization', staffAuthorization)
      .send({ reason: 'Release for retry' })
      .expect(200);
    await post().set('Idempotency-Key', 'booking-retry-0001').send(input).expect(201);
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
      const response = await post()
        .set('Idempotency-Key', 'invalid-dto-0001')
        .send(body)
        .expect(400);
      expect(response.get('Content-Type')).toMatch(/application\/problem\+json/);
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
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', staffAuthorization)
        .expect(status);
      expect(response.get('Content-Type')).toMatch(/application\/problem\+json/);
      expect(response.body).toMatchObject({ status, instance: path });
      for (const field of ['type', 'title', 'detail']) {
        expect(response.body).toHaveProperty(field, expect.any(String));
      }
    }
    const { input } = await fixture();
    await kit.dataSource.getRepository(Renter).delete(input.renterId);
    await post().set('Idempotency-Key', 'no-renter-0001').send(input).expect(404);
  });

  it('paginates games without duplicates and serves game details with platform IDs', async () => {
    const catalogFixtures = await Promise.all([catalog(), catalog(), catalog()]);
    const one = await request(app.getHttpServer())
      .get('/games?limit=2')
      .set('Authorization', staffAuthorization)
      .expect(200);
    const first = one.body as Page;
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const two = await request(app.getHttpServer())
      .get('/games')
      .set('Authorization', staffAuthorization)
      .query({ limit: 2, cursor: first.next_cursor })
      .expect(200);
    const second = two.body as Page;
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    expect([...first.items, ...second.items].map(item => item.gameId)).toEqual(
      catalogFixtures.map(item => item.game.gameId).sort(),
    );
    const game = catalogFixtures[0];
    const detail = await request(app.getHttpServer())
      .get(`/games/${game.game.gameId}`)
      .set('Authorization', staffAuthorization)
      .expect(200);
    expect(detail.body).toMatchObject({
      gameId: game.game.gameId,
      platforms: [{ platformId: game.platform.platformId, name: game.platform.name }],
    });
    await request(app.getHttpServer())
      .get('/rentals')
      .set('Authorization', staffAuthorization)
      .query({ cursor: first.next_cursor })
      .expect(400);
  });

  it('paginates rentals and returns an empty terminal page', async () => {
    await request(app.getHttpServer())
      .get('/rentals')
      .set('Authorization', staffAuthorization)
      .expect(200, { items: [], next_cursor: null });
    const renter = await kit.dataSource.getRepository(Renter).save(aRenter());
    const rentals = await kit.dataSource
      .getRepository(Rental)
      .save([aRental(renter.renterId), aRental(renter.renterId), aRental(renter.renterId)]);
    const one = await request(app.getHttpServer())
      .get('/rentals?limit=2')
      .set('Authorization', staffAuthorization)
      .expect(200);
    const first = one.body as Page;
    const two = await request(app.getHttpServer())
      .get('/rentals')
      .set('Authorization', staffAuthorization)
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
    await request(app.getHttpServer())
      .get(`/games?${query}`)
      .set('Authorization', staffAuthorization)
      .expect(400);
  });

  it('publishes eight documented operations with required idempotency and problem media types', () => {
    const spec = createApiDocument(app);
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/games',
      '/games/{gameId}',
      '/rentals',
      '/rentals/{rentalId}',
      '/rentals/{rentalId}/cancel',
      '/rentals/{rentalId}/issue',
      '/rentals/{rentalId}/return',
    ]);
    const operations = Object.values(spec.paths).flatMap(path =>
      [path.get, path.post].filter(operation => operation !== undefined),
    );
    expect(operations).toHaveLength(8);
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
    expect(create.security).toEqual([{ bearer: [] }]);
    expect(create.responses['401']).toHaveProperty('content.application/problem+json');
    expect(create.responses['403']).toHaveProperty('content.application/problem+json');
    expect(spec.paths['/games'].get?.security ?? []).toEqual([]);
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
