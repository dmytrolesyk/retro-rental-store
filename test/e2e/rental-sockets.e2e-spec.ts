import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
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
} from '../../src/database/entities';
import { RentalOutboxDispatcher } from '../../src/outbox/rental-outbox.dispatcher';
import type { RentalStatusChanged } from '../../src/rentals/rental-status-event';
import type { CreatedRentalDto } from '../../src/rentals/rentals.dto';
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

interface ServerEvents {
  'rental.status': (event: RentalStatusChanged) => void;
}
interface ClientEvents {
  join: (input: unknown, ack: (result: unknown) => void) => void;
}
type RentalClient = Socket<ServerEvents, ClientEvents>;
const join = (socket: RentalClient, input: unknown): Promise<unknown> =>
  socket.timeout(3000).emitWithAck('join', input);

function nextStatus(socket: RentalClient): Promise<RentalStatusChanged> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('rental.status', receive);
      reject(new Error('Status event timed out'));
    }, 5000);
    function receive(event: RentalStatusChanged) {
      clearTimeout(timer);
      resolve(event);
    }
    socket.once('rental.status', receive);
  });
}

describe('Rental Socket.IO API (full AppModule)', () => {
  let kit: PostgresTestkit;
  let app: INestApplication<App>;
  let stopPostgres: (() => Promise<void>) | undefined;
  let closeApplication: (() => Promise<void>) | undefined;
  let restoreEnvironment: (() => void) | undefined;
  let url: string;
  const clients: RentalClient[] = [];

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
      RENTAL_OUTBOX_ENABLED: 'true',
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
    const { AppModule } =
      jest.requireActual<typeof import('../../src/app.module')>('../../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    closeApplication = () => module.close();
    app = module.createNestApplication<INestApplication<App>>({ logger: false });
    closeApplication = () => app.close();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  beforeEach(async () => {
    await app.get(RentalOutboxDispatcher).waitForIdle();
    await kit.reset();
  });
  afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect();
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

  async function connect(
    token: unknown = testIdentities[0].token,
    transport: 'websocket' | 'polling' = 'websocket',
  ) {
    const socket: RentalClient = io(url, {
      auth: token === null ? {} : { token },
      autoConnect: false,
      reconnection: false,
      transports: [transport],
      timeout: 3000,
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  }

  async function rentalFor(renterId: string = clientPrincipal.renterId) {
    await kit.dataSource.getRepository(Renter).save(aRenter({ renterId }));
    return kit.dataSource.getRepository(Rental).save(aRental(renterId));
  }

  async function booking() {
    const catalog = aCatalog();
    await kit.dataSource.getRepository(Game).save(catalog.game);
    await kit.dataSource.getRepository(Platform).save(catalog.platform);
    await kit.dataSource.getRepository(GamePlatform).save(catalog.gamePlatform);
    await kit.dataSource.getRepository(GameCopy).save(catalog.copy);
    await kit.dataSource
      .getRepository(Renter)
      .save(aRenter({ renterId: clientPrincipal.renterId }));
    const response = await request(app.getHttpServer())
      .post('/rentals')
      .set('Authorization', clientAuthorization)
      .set('Idempotency-Key', randomUUID())
      .send({
        renterId: clientPrincipal.renterId,
        gameId: catalog.game.gameId,
        platformId: catalog.platform.platformId,
      })
      .expect(201);
    await app.get(RentalOutboxDispatcher).waitForIdle();
    return response.body as CreatedRentalDto;
  }

  it.each([
    ['missing', undefined],
    ['malformed', 'bad'],
    ['unknown', 'x'.repeat(64)],
    ['non-string', { role: 'staff' }],
  ])('rejects %s handshake credentials before connection', async (_name, token) => {
    // Explicit undefined must not use connect()'s default valid credentials.
    await expect(connect(token === undefined ? null : token)).rejects.toMatchObject({
      message: 'Unauthorized',
      data: { code: 'UNAUTHORIZED' },
    });
  });

  it('permits owner and staff joins, refuses another owner and normalizes the UUID', async () => {
    const rental = await rentalFor();
    const owner = await connect();
    const other = await connect(testIdentities[1].token);
    const staff = await connect(testIdentities[2].token);
    expect(await join(owner, { rentalId: rental.rentalId.toUpperCase() })).toEqual({
      ok: true,
      rentalId: rental.rentalId,
    });
    expect(await join(staff, { rentalId: rental.rentalId })).toEqual({
      ok: true,
      rentalId: rental.rentalId,
    });
    expect(await join(other, { rentalId: rental.rentalId })).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await join(owner, { rentalId: randomUUID() })).toEqual({
      ok: false,
      error: { code: 'RENTAL_NOT_FOUND' },
    });
    // A rejected join must not kill the connection or future handlers.
    const own = await rentalFor(otherPrincipal.renterId);
    expect(await join(other, { rentalId: own.rentalId })).toEqual({
      ok: true,
      rentalId: own.rentalId,
    });
  });

  it('rejects malformed or spoofed join payloads with an ack and keeps HTTP errors working', async () => {
    const rental = await rentalFor();
    const socket = await connect();
    for (const body of [
      null,
      'rentals:any',
      [],
      {},
      { rentalId: 'bad' },
      { rentalId: rental.rentalId, role: 'staff' },
      { rentalId: rental.rentalId, renterId: otherPrincipal.renterId },
    ]) {
      expect(await join(socket, body)).toEqual({ ok: false, error: { code: 'INVALID_JOIN' } });
    }
    expect(await join(socket, { rentalId: rental.rentalId })).toMatchObject({ ok: true });
    await request(app.getHttpServer())
      .get(`/rentals/${randomUUID()}`)
      .set('Authorization', staffAuthorization)
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);
  });

  it('publishes an issued status through outbox only to its room, with same-room control', async () => {
    const booked = await booking();
    const otherRental = await rentalFor(otherPrincipal.renterId);
    const a = await connect();
    const sameRoom = await connect();
    const b = await connect(testIdentities[1].token);
    expect(await join(a, { rentalId: booked.rentalId })).toMatchObject({ ok: true });
    expect(await join(sameRoom, { rentalId: booked.rentalId })).toMatchObject({ ok: true });
    expect(await join(b, { rentalId: otherRental.rentalId })).toMatchObject({ ok: true });
    const receivedA: RentalStatusChanged[] = [];
    const receivedSame: RentalStatusChanged[] = [];
    const receivedB: RentalStatusChanged[] = [];
    a.on('rental.status', event => receivedA.push(event));
    sameRoom.on('rental.status', event => receivedSame.push(event));
    b.on('rental.status', event => receivedB.push(event));
    const arrived = Promise.all([nextStatus(a), nextStatus(sameRoom)]);
    await request(app.getHttpServer())
      .post(`/rentals/${booked.rentalId}/issue`)
      .set('Authorization', staffAuthorization)
      .expect(200);
    await app.get(RentalOutboxDispatcher).waitForIdle();
    const [first, second] = await arrived;
    // Per-socket ack barriers fence preceding outbound packets; no arbitrary sleep.
    await Promise.all([
      join(a, { rentalId: booked.rentalId }),
      join(sameRoom, { rentalId: booked.rentalId }),
      join(b, { rentalId: otherRental.rentalId }),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      rentalId: booked.rentalId,
      previousStatus: 'BOOKED',
      status: 'ACTIVE',
    });
    expect(first.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toHaveProperty('emailTo');
    expect(first).not.toHaveProperty('emailNotification');
    expect(first).not.toHaveProperty('position');
    expect(receivedA).toEqual([first]);
    expect(receivedSame).toEqual([first]);
    expect(receivedB).toEqual([]);
  });

  it('supports polling transport and requires a fresh join after reconnect', async () => {
    const booked = await booking();
    const socket = await connect(testIdentities[0].token, 'polling');
    expect(await join(socket, { rentalId: booked.rentalId })).toMatchObject({ ok: true });
    const previousId = socket.id;
    socket.disconnect();
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    expect(socket.id).not.toBe(previousId);
    const received: RentalStatusChanged[] = [];
    socket.on('rental.status', event => received.push(event));
    await request(app.getHttpServer())
      .post(`/rentals/${booked.rentalId}/issue`)
      .set('Authorization', staffAuthorization)
      .expect(200);
    await app.get(RentalOutboxDispatcher).waitForIdle();
    // The join ack fences the missed ACTIVE event; there is no replay on join.
    expect(await join(socket, { rentalId: booked.rentalId })).toMatchObject({ ok: true });
    expect(received).toEqual([]);
    const returned = nextStatus(socket);
    await request(app.getHttpServer())
      .post(`/rentals/${booked.rentalId}/return`)
      .set('Authorization', staffAuthorization)
      .expect(200);
    expect(await returned).toMatchObject({ rentalId: booked.rentalId, status: 'RETURNED' });
    await app.get(RentalOutboxDispatcher).waitForIdle();
  });
});
