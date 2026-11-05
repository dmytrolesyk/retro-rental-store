import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RENTAL_DEADLINES_JOB } from '../../src/rentals/rental-deadlines.scheduler';
import { ProcessRentalDeadlines } from '../../src/rentals/use-cases/process-rental-deadlines';
import { RentalOutboxDispatcher } from '../../src/outbox/rental-outbox.dispatcher';
import { ProcessRentalOutbox } from '../../src/outbox/process-rental-outbox';
import { RentalEventsService } from '../../src/realtime/rental-events.service';
import {
  clientPrincipal,
  testIdentities,
  clientAuthorization,
  staffAuthorization,
} from '../integration/testkit/auth';
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
  RentalItem,
  Renter,
  RentalJob,
} from '../../src/database/entities';
import type { CreatedRentalDto } from '../../src/rentals/rentals.dto';
import { aCatalog, aRenter, aRental, aRentalItem } from '../integration/testkit/builders';
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
      AUTH_IDENTITIES: JSON.stringify(testIdentities),
      PORT: '3000',
      LOG_LEVEL: 'error',
      TIMEOUT_MS: '5000',
      RENTAL_DEADLINES_ENABLED: 'false',
      RENTAL_OUTBOX_ENABLED: 'false',
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
    const catalogFixture = aCatalog();
    const dataSource = kit.dataSource;
    await dataSource.getRepository(Game).save(catalogFixture.game);
    await dataSource.getRepository(Platform).save(catalogFixture.platform);
    await dataSource.getRepository(GamePlatform).save(catalogFixture.gamePlatform);
    await dataSource.getRepository(GameCopy).save(catalogFixture.copy);
    const renter = await dataSource
      .getRepository(Renter)
      .save(aRenter({ renterId: clientPrincipal.renterId }));
    return {
      catalogFixture,
      renter,
      input: {
        renterId: renter.renterId,
        gameId: catalogFixture.game.gameId,
        platformId: catalogFixture.platform.platformId,
      },
    };
  }

  it('registers one five-minute cron, honors disablement and executes real deadline processing', async () => {
    const schedulerRegistry = app.get(SchedulerRegistry);
    expect(schedulerRegistry.getCronJobs().size).toBe(1);
    const cronJob = schedulerRegistry.getCronJob(RENTAL_DEADLINES_JOB);
    expect(cronJob.waitForCompletion).toBe(true);
    const nextRun = cronJob.nextDate().toJSDate();
    expect(nextRun.getMinutes() % 5).toBe(0);
    expect(nextRun.getSeconds()).toBe(0);
    const configService = app.get(ConfigService);
    const processor = app.get(ProcessRentalDeadlines);
    const executeSpy = jest.spyOn(processor, 'execute');
    try {
      await cronJob.fireOnTick();
      expect(executeSpy).not.toHaveBeenCalled();
      const { renter, catalogFixture } = await fixture();
      const rental = await kit.dataSource.getRepository(Rental).save(aRental(renter.renterId));
      await kit.dataSource
        .getRepository(RentalItem)
        .save(aRentalItem(rental.rentalId, catalogFixture.copy.gameCopyId));
      configService.set('RENTAL_DEADLINES_ENABLED', true);
      await cronJob.fireOnTick();
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(
        (await kit.dataSource.getRepository(Rental).findOneByOrFail({ rentalId: rental.rentalId }))
          .status,
      ).toBe('OVERDUE');
    } finally {
      configService.set('RENTAL_DEADLINES_ENABLED', false);
      executeSpy.mockRestore();
    }
  });

  it('honors relay disablement and dispatches after commit without waiting for a cron tick', async () => {
    const dispatcher = app.get(RentalOutboxDispatcher);
    const configService = app.get(ConfigService);
    const executeSpy = jest.spyOn(app.get(ProcessRentalOutbox), 'execute');
    const received: string[] = [];
    const subscription = app
      .get(RentalEventsService)
      .events$.subscribe(event => received.push(event.status));
    try {
      const { input } = await fixture();
      const booking = await request(app.getHttpServer())
        .post('/rentals')
        .set('Authorization', clientAuthorization)
        .set('Idempotency-Key', randomUUID())
        .send(input)
        .expect(201);
      await dispatcher.waitForIdle();
      expect(executeSpy).not.toHaveBeenCalled();
      expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(0);
      configService.set('RENTAL_OUTBOX_ENABLED', true);
      dispatcher.onApplicationBootstrap();
      await dispatcher.waitForIdle();
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(received).toEqual(['BOOKED']);
      const rentalId = (booking.body as CreatedRentalDto).rentalId;
      await request(app.getHttpServer())
        .post(`/rentals/${rentalId}/issue`)
        .set('Authorization', staffAuthorization)
        .expect(200);
      await dispatcher.waitForIdle();
      expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(2);
      expect(received).toEqual(['BOOKED', 'ACTIVE']);
    } finally {
      configService.set('RENTAL_OUTBOX_ENABLED', false);
      await dispatcher.waitForIdle();
      subscription.unsubscribe();
      executeSpy.mockRestore();
    }
  });

  it('rejects anonymous rental access while the catalog remains public', async () => {
    const response = await request(app.getHttpServer()).get('/rentals').expect(401);
    expectProblem(response, 401, '/rentals');
    await request(app.getHttpServer()).get('/games').expect(200);
  });

  it('books, issues and returns a copy through the real HTTP application', async () => {
    const { catalogFixture, renter, input } = await fixture();
    const response = await request(app.getHttpServer())
      .post('/rentals')
      .set('Authorization', clientAuthorization)
      .set('Idempotency-Key', `e2e-${randomUUID()}`)
      .send(input)
      .expect(201);
    const created = response.body as CreatedRentalDto;
    expect(created).toMatchObject({
      status: 'BOOKED',
      gameCopyId: catalogFixture.copy.gameCopyId,
      costPerDay: catalogFixture.copy.pricePerDay,
    });
    const location = response.get('Location');
    expect(location).toBe(`/rentals/${created.rentalId}`);
    if (!location) throw new Error('POST /rentals did not return Location');
    expect(response.get('Idempotency-Replay')).toBe('false');
    const stored = await kit.dataSource
      .getRepository(Rental)
      .findOneByOrFail({ rentalId: created.rentalId });
    expect(stored.status).toBe('BOOKED');
    expect(stored.rentedAt).toBeNull();
    const read = await request(app.getHttpServer())
      .get(location)
      .set('Authorization', clientAuthorization)
      .expect(200);
    expect(read.body).toMatchObject({
      rentalId: created.rentalId,
      renterId: renter.renterId,
      status: 'BOOKED',
      rentedAt: null,
      items: [
        {
          gameCopyId: catalogFixture.copy.gameCopyId,
          costPerDay: catalogFixture.copy.pricePerDay,
          returnedAt: null,
          releasedAt: null,
        },
      ],
    });
    await expect(
      kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: renter.renterId }),
    ).resolves.toMatchObject({ balance: renter.balance });
    const issued = await request(app.getHttpServer())
      .post(`${location}/issue`)
      .set('Authorization', staffAuthorization)
      .expect(200);
    expect(issued.body).toHaveProperty('rentedAt', expect.any(String));
    expect(issued.body).toHaveProperty('dueAt', expect.any(String));
    expect(issued.body).toMatchObject({
      status: 'ACTIVE',
    });
    await expect(
      kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: renter.renterId }),
    ).resolves.toMatchObject({ balance: renter.balance - catalogFixture.copy.pricePerDay });
    const returned = await request(app.getHttpServer())
      .post(`${location}/return`)
      .set('Authorization', staffAuthorization)
      .expect(200);
    expect(returned.body).toHaveProperty('items.0.returnedAt', expect.any(String));
    expect(returned.body).toHaveProperty('items.0.releasedAt', expect.any(String));
    expect(returned.body).toMatchObject({
      status: 'RETURNED',
    });
  });

  it('returns problem details with 404 for a valid UUID without a rental', async () => {
    const path = `/rentals/${randomUUID()}`;
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', staffAuthorization);
    expect(response.body).toMatchObject({ status: 404, detail: 'Rental not found' });
    expectProblem(response, 404, path);
  });

  it('returns problem details with 400 for a malformed rental UUID', async () => {
    const path = '/rentals/not-a-uuid';
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', staffAuthorization)
      .expect(400);
    expectProblem(response, 400, path);
  });

  it('validates body and headers through the shared application configuration', async () => {
    const { input, renter } = await fixture();
    const missingKey = await request(app.getHttpServer())
      .post('/rentals')
      .set('Authorization', clientAuthorization)
      .send(input)
      .expect(400);
    expectProblem(missingKey, 400, '/rentals');
    const unknownField = await request(app.getHttpServer())
      .post('/rentals')
      .set('Authorization', clientAuthorization)
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
