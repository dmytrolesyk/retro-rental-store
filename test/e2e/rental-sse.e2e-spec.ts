import { RentalStatusEventWriter } from '../../src/rentals/rental-status-event.writer';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { defer, EMPTY, finalize } from 'rxjs';
import type { Observable } from 'rxjs';
import type { RentalStatusChanged } from '../../src/rentals/rental-status-event';
import { RentalReplayService } from '../../src/realtime/rental-replay.service';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../../src/configure-app';
import {
  Game,
  GameCopy,
  GamePlatform,
  Platform,
  Rental,
  Renter,
  RentalOutboxEvent,
} from '../../src/database/entities';
import { RentalsRepository } from '../../src/rentals/rentals.repository';
import type { CreatedRentalDto } from '../../src/rentals/rentals.dto';
import type { RentalHistoryEntry } from '../../src/realtime/rental-event-history.repository';
import { RentalEventHistoryRepository } from '../../src/realtime/rental-event-history.repository';
import { RentalEventsService } from '../../src/realtime/rental-events.service';
import { ProcessRentalOutbox } from '../../src/outbox/process-rental-outbox';
import { RentalOutboxDispatcher } from '../../src/outbox/rental-outbox.dispatcher';
import { aCatalog, aRental, aRenter } from '../integration/testkit/builders';
import {
  clientPrincipal,
  otherPrincipal,
  testIdentities,
  clientAuthorization,
  staffAuthorization,
} from '../integration/testkit/auth';
import { startPostgres } from '../integration/testkit/postgres';
import type { PostgresTestkit } from '../integration/testkit/postgres';
import { openEventStream } from './testkit/sse';

describe('Rental SSE API (full AppModule)', () => {
  let kit: PostgresTestkit;
  let app: INestApplication<App>;
  let closeApplication: (() => Promise<void>) | undefined;
  let stopPostgres: (() => Promise<void>) | undefined;
  let restoreEnvironment: (() => void) | undefined;
  let url: string;
  const streams: Awaited<ReturnType<typeof openEventStream>>[] = [];

  async function bootstrap() {
    const { AppModule } =
      jest.requireActual<typeof import('../../src/app.module')>('../../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    closeApplication = () => module.close();
    app = module.createNestApplication<INestApplication<App>>({ logger: false });
    closeApplication = () => app.close();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  }
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
    await bootstrap();
  });
  beforeEach(async () => {
    await app.get(RentalOutboxDispatcher).waitForIdle();
    await kit.reset();
  });
  afterEach(async () => {
    for (const stream of streams.splice(0)) stream.close();
    app.get(ConfigService).set('RENTAL_OUTBOX_ENABLED', false);
    await app.get(RentalOutboxDispatcher).waitForIdle();
    jest.restoreAllMocks();
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

  async function fixture(renterId: string = clientPrincipal.renterId) {
    await kit.dataSource.getRepository(Renter).save(aRenter({ renterId }));
    return kit.dataSource.getRepository(Rental).save(aRental(renterId));
  }
  async function record(
    rentalId: string,
    status: Rental['status'],
    previousStatus: Rental['status'],
  ) {
    const repository = new RentalsRepository(kit.dataSource);
    await kit.dataSource.transaction(async manager => {
      await repository.findForUpdate(manager, rentalId);
      await manager.update(Rental, rentalId, { status });
      await app
        .get(RentalStatusEventWriter)
        .recordStatusChange(manager, rentalId, previousStatus, new Date());
    });
    return kit.dataSource.getRepository(RentalOutboxEvent).findOneByOrFail({ rentalId, status });
  }
  async function connect(rentalId: string, cursor?: string, authorization = clientAuthorization) {
    const headers: Record<string, string> = { Authorization: authorization };
    if (cursor !== undefined) headers['Last-Event-ID'] = cursor;
    const stream = await openEventStream(`${url}/rentals/${rentalId}/events`, headers);
    streams.push(stream);
    return stream;
  }

  it('returns HTTP problem errors before opening SSE for invalid credentials, IDs and access', async () => {
    const rental = await fixture(otherPrincipal.renterId);
    const path = `/rentals/${rental.rentalId}/events`;
    for (const authorization of [undefined, 'Bearer invalid']) {
      let pending = request(app.getHttpServer()).get(path);
      if (authorization) pending = pending.set('Authorization', authorization);
      await pending.expect(401).expect('Content-Type', /application\/problem\+json/);
    }
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', clientAuthorization)
      .expect(403)
      .expect('Content-Type', /application\/problem\+json/);
    await request(app.getHttpServer())
      .get(`/rentals/${randomUUID()}/events`)
      .set('Authorization', staffAuthorization)
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);
    await request(app.getHttpServer())
      .get('/rentals/bad/events')
      .set('Authorization', staffAuthorization)
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);
    const staffStream = await connect(rental.rentalId, undefined, staffAuthorization);
    await staffStream.ready();
    expect(staffStream.status).toBe(200);
  });

  it('rejects empty, numeric, unknown, foreign and duplicate cursors before SSE headers', async () => {
    const rental = await fixture();
    const other = await fixture(otherPrincipal.renterId);
    const foreign = await record(other.rentalId, 'ACTIVE', 'BOOKED');
    for (const cursor of ['', '3', randomUUID(), foreign.eventId]) {
      await request(app.getHttpServer())
        .get(`/rentals/${rental.rentalId}/events`)
        .set('Authorization', clientAuthorization)
        .set('Last-Event-ID', cursor)
        .expect(400)
        .expect('Content-Type', /application\/problem\+json/);
    }
    const own = await record(rental.rentalId, 'ACTIVE', 'BOOKED');
    const duplicate = await new Promise<{
      status: number | undefined;
      contentType: string | undefined;
    }>((resolve, reject) => {
      const pending = httpRequest(
        `${url}/rentals/${rental.rentalId}/events`,
        {
          agent: false,
          headers: [
            'Host',
            new URL(url).host,
            'Authorization',
            clientAuthorization,
            'Last-Event-ID',
            own.eventId,
            'Last-Event-ID',
            own.eventId,
          ],
        },
        response => {
          response.resume();
          response.once('end', () => {
            resolve({ status: response.statusCode, contentType: response.headers['content-type'] });
          });
        },
      );
      pending.once('error', reject);
      pending.setTimeout(5000, () =>
        pending.destroy(new Error('Duplicate header request timed out')),
      );
      pending.end();
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.contentType).toContain('application/problem+json');
  });

  it('replays committed unpublished history in order with UUID IDs and no private data', async () => {
    const rental = await fixture();
    const active = await record(rental.rentalId, 'ACTIVE', 'BOOKED');
    const overdue = await record(rental.rentalId, 'OVERDUE', 'ACTIVE');
    const other = await fixture(otherPrincipal.renterId);
    await record(other.rentalId, 'ACTIVE', 'BOOKED');
    const stream = await connect(rental.rentalId.toUpperCase());
    expect(stream.status).toBe(200);
    expect(stream.contentType).toContain('text/event-stream');
    expect(await stream.events(2)).toEqual([active.payload, overdue.payload]);
    expect(stream.frames[0]).toBe(': connected');
    expect(stream.frames[1]).toContain(
      `event: rental.status\nid: ${active.eventId}\nretry: 1000\n`,
    );
    expect(stream.frames[2]).toContain(
      `event: rental.status\nid: ${overdue.eventId}\nretry: 1000\n`,
    );
    expect(stream.frames.join('\n')).not.toContain('emailTo');
    expect(
      await kit.dataSource.query(
        'SELECT count(*)::int AS count FROM rental_outbox_deliveries WHERE processed_at IS NOT NULL',
      ),
    ).toEqual([{ count: 0 }]);
  });

  it('delivers a live HTTP status change through the outbox', async () => {
    const catalog = aCatalog();
    await kit.dataSource.getRepository(Game).save(catalog.game);
    await kit.dataSource.getRepository(Platform).save(catalog.platform);
    await kit.dataSource.getRepository(GamePlatform).save(catalog.gamePlatform);
    await kit.dataSource.getRepository(GameCopy).save(catalog.copy);
    await kit.dataSource
      .getRepository(Renter)
      .save(aRenter({ renterId: clientPrincipal.renterId }));
    const booking = await request(app.getHttpServer())
      .post('/rentals')
      .set('Authorization', clientAuthorization)
      .set('Idempotency-Key', randomUUID())
      .send({
        renterId: clientPrincipal.renterId,
        gameId: catalog.game.gameId,
        platformId: catalog.platform.platformId,
      })
      .expect(201);
    const { rentalId } = booking.body as CreatedRentalDto;
    const stream = await connect(rentalId);
    expect((await stream.events(1))[0].status).toBe('BOOKED');
    app.get(ConfigService).set('RENTAL_OUTBOX_ENABLED', true);
    app.get(RentalOutboxDispatcher).wake();
    await app.get(RentalOutboxDispatcher).waitForIdle();
    await request(app.getHttpServer())
      .post(`/rentals/${rentalId}/issue`)
      .set('Authorization', staffAuthorization)
      .expect(200);
    await app.get(RentalOutboxDispatcher).waitForIdle();
    const events = await stream.events(2);
    expect(events.map(event => event.status)).toEqual(['BOOKED', 'ACTIVE']);
    const stored = await kit.dataSource
      .getRepository(RentalOutboxEvent)
      .findOneByOrFail({ rentalId, status: 'ACTIVE' });
    expect(events[1]).toEqual(stored.payload);
  });

  it('resumes after UUID and does not duplicate history when pending events are published later', async () => {
    const rental = await fixture();
    const active = await record(rental.rentalId, 'ACTIVE', 'BOOKED');
    const first = await connect(rental.rentalId);
    await first.events(1);
    first.close();
    const overdue = await record(rental.rentalId, 'OVERDUE', 'ACTIVE');
    const resumed = await connect(rental.rentalId, active.eventId);
    expect(await resumed.events(1)).toEqual([overdue.payload]);
    await app.get(ProcessRentalOutbox).execute();
    const returned = await record(rental.rentalId, 'RETURNED', 'OVERDUE');
    await app.get(ProcessRentalOutbox).execute();
    expect(await resumed.events(2)).toEqual([overdue.payload, returned.payload]);
  });

  it('releases the replay signal subscription after HTTP disconnect', async () => {
    const rental = await fixture();
    const bus = app.get(RentalEventsService);
    const signals = bus.forRental(rental.rentalId);
    let done!: () => void;
    const cleaned = new Promise<void>(resolve => {
      done = resolve;
    });
    jest.spyOn(bus, 'forRental').mockReturnValue(signals.pipe(finalize(done)));
    const stream = await connect(rental.rentalId);
    await stream.ready();
    stream.close();
    await cleaned;
  });

  it('does not subscribe the prepared replay after disconnect during async setup', async () => {
    const rental = await fixture();
    let prepared!: (source: Observable<RentalStatusChanged>) => void;
    let started!: () => void;
    const preparing = new Promise<void>(resolve => {
      started = resolve;
    });
    const pending = new Promise<Observable<RentalStatusChanged>>(resolve => {
      prepared = resolve;
    });
    jest.spyOn(app.get(RentalReplayService), 'open').mockImplementationOnce(() => {
      started();
      return pending;
    });
    const disconnected = new Promise<void>(resolve => {
      const server = app.getHttpServer() as Server;
      server.once('connection', socket => {
        socket.once('close', resolve);
      });
    });
    const req = httpRequest(`${url}/rentals/${rental.rentalId}/events`, {
      headers: { Authorization: clientAuthorization },
      agent: false,
    });
    req.on('error', () => undefined);
    req.end();
    await preparing;
    req.destroy();
    await disconnected;
    const subscribed = jest.fn(() => EMPTY);
    prepared(defer(subscribed));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(subscribed).not.toHaveBeenCalled();
  });

  it('closes an opened stream on DB failure without leaking raw error text', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const rental = await fixture();
    let reject!: (error: Error) => void;
    const pending = new Promise<RentalHistoryEntry[]>((_resolve, fail) => {
      reject = fail;
    });
    jest.spyOn(app.get(RentalEventHistoryRepository), 'readAfter').mockReturnValueOnce(pending);
    const stream = await connect(rental.rentalId);
    await stream.ready();
    reject(new Error('PRIVATE SQL details'));
    await stream.closed();
    expect(stream.frames).toEqual([': connected']);
  });

  it('documents the authenticated SSE route and UUID header in OpenAPI', async () => {
    const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const document = docs.body as {
      paths: Record<
        string,
        {
          get: {
            operationId: string;
            security: unknown[];
            parameters: { name: string }[];
            responses: Record<string, { content: Record<string, unknown> }>;
          };
        }
      >;
    };
    const route = document.paths['/rentals/{id}/events'].get;
    expect(route.operationId).toBe('streamRentalEvents');
    expect(route.security).toEqual([{ bearer: [] }]);
    expect(route.parameters.map(parameter => parameter.name)).toContain('Last-Event-ID');
    expect(route.responses['200'].content).toHaveProperty('text/event-stream');
  });

  it('closes active SSE on API restart and replays retained processed history in a fresh app', async () => {
    const rental = await fixture();
    const active = await record(rental.rentalId, 'ACTIVE', 'BOOKED');
    const overdue = await record(rental.rentalId, 'OVERDUE', 'ACTIVE');
    await app.get(ProcessRentalOutbox).execute();
    const old = await connect(rental.rentalId);
    await old.events(2);
    await app.close();
    await old.closed();
    await bootstrap();
    const resumed = await connect(rental.rentalId, active.eventId);
    expect(await resumed.events(1)).toEqual([overdue.payload]);
  });
});
