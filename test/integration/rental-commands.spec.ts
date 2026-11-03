import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthModule } from '../../src/auth/auth.module';
import { RentalsController } from '../../src/rentals/rentals.controller';
import { RentalsService } from '../../src/rentals/rentals.service';
import { IssueRental } from '../../src/rentals/use-cases/issue-rental';
import { CancelRental } from '../../src/rentals/use-cases/cancel-rental';
import { ReturnRental } from '../../src/rentals/use-cases/return-rental';
import { RentalsRepository } from '../../src/rentals/rentals.repository';
import { CreateRentalResponseInterceptor } from '../../src/rentals/create-rental-response.interceptor';
import { AUTH_IDENTITIES } from '../../src/auth/auth.config';
import { configureApp } from '../../src/configure-app';
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
import { aCatalog, aRenter, aRental, aRentalItem } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';
import {
  clientPrincipal,
  clientAuthorization,
  otherAuthorization,
  staffAuthorization,
  testIdentities,
} from './testkit/auth';

interface Booking {
  rentalId: string;
  gameCopyId: string;
  status: string;
  bookedAt: string;
  bookingExpiresAt: string;
  costPerDay: number;
}
interface Detail {
  status: string;
  rentedAt: string | null;
  dueAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancelledBy: string | null;
  items: { returnedAt: string | null; releasedAt: string | null }[];
}

describe('Rental booking and commands', () => {
  let kit: PostgresTestkit;
  let app: INestApplication<App>;
  let closeApp: (() => Promise<void>) | undefined;
  let stopPostgres: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    kit = await startPostgres();
    stopPostgres = () => kit.stop();
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [RentalsController],
      providers: [
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
    closeApp = () => app.close();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    await kit.reset();
  });
  afterAll(async () => {
    try {
      await closeApp?.();
    } finally {
      await stopPostgres?.();
    }
  });

  async function fixture(balance = 10000) {
    const dataSource = kit.dataSource;
    const catalogFixture = aCatalog();
    await dataSource.getRepository(Game).save(catalogFixture.game);
    await dataSource.getRepository(Platform).save(catalogFixture.platform);
    await dataSource.getRepository(GamePlatform).save(catalogFixture.gamePlatform);
    await dataSource.getRepository(GameCopy).save(catalogFixture.copy);
    const renter = await dataSource
      .getRepository(Renter)
      .save(aRenter({ renterId: clientPrincipal.renterId, balance }));
    const input = {
      renterId: renter.renterId,
      gameId: catalogFixture.game.gameId,
      platformId: catalogFixture.platform.platformId,
    };
    return { catalogFixture, renter, input };
  }
  const post = () =>
    request(app.getHttpServer()).post('/rentals').set('Authorization', clientAuthorization);
  const command = (id: string, action: string, auth = staffAuthorization) =>
    request(app.getHttpServer()).post(`/rentals/${id}/${action}`).set('Authorization', auth);
  async function book(balance = 10000) {
    const fixtureData = await fixture(balance);
    const response = await post()
      .set('Idempotency-Key', randomUUID())
      .send(fixtureData.input)
      .expect(201);
    return { ...fixtureData, booking: response.body as Booking };
  }
  async function balance() {
    return (
      await kit.dataSource
        .getRepository(Renter)
        .findOneByOrFail({ renterId: clientPrincipal.renterId })
    ).balance;
  }

  it('reserves for exactly a day without payment and queues a booking email, then charges the booked price once at issue', async () => {
    const { booking, catalogFixture } = await book();
    expect(booking.status).toBe('BOOKED');
    expect(
      new Date(booking.bookingExpiresAt).getTime() - new Date(booking.bookedAt).getTime(),
    ).toBe(86400000);
    expect(await balance()).toBe(10000);
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(1);
    await kit.dataSource
      .getRepository(GameCopy)
      .update(catalogFixture.copy.gameCopyId, { pricePerDay: 9000 });
    const first = await command(booking.rentalId, 'issue').expect(200);
    const detail = first.body as Detail;
    expect(detail.status).toBe('ACTIVE');
    expect(new Date(detail.dueAt ?? '').getTime() - new Date(detail.rentedAt ?? '').getTime()).toBe(
      86400000,
    );
    const repeats = await Promise.all([
      command(booking.rentalId, 'issue'),
      command(booking.rentalId, 'issue'),
    ]);
    for (const response of repeats) {
      expect(response.status).toBe(200);
      expect(response.body).toEqual(first.body);
    }
    expect(await balance()).toBe(7500);
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(2);
  });

  it('permits booking without funds but failed issue has no partial effects and is retryable after replenishment', async () => {
    const { booking } = await book(0);
    await command(booking.rentalId, 'issue').expect(409);
    expect(await balance()).toBe(0);
    expect(
      await kit.dataSource.getRepository(Rental).findOneByOrFail({ rentalId: booking.rentalId }),
    ).toMatchObject({ status: 'BOOKED', rentedAt: null, dueAt: null });
    await kit.dataSource.getRepository(Renter).update(clientPrincipal.renterId, { balance: 10000 });
    await command(booking.rentalId, 'issue').expect(200);
    expect(await balance()).toBe(7500);
  });

  it('cancels and frees a copy without a fake return or refund; repeat preserves the first reason', async () => {
    const { booking, input } = await book();
    const first = await command(booking.rentalId, 'cancel', clientAuthorization)
      .send({ reason: 'Plans changed' })
      .expect(200);
    expect(first.body).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: clientPrincipal.id,
      cancellationReason: 'Plans changed',
      rentedAt: null,
    });
    const again = await command(booking.rentalId, 'cancel', clientAuthorization)
      .send({ reason: 'Another reason' })
      .expect(200);
    expect(again.body).toEqual(first.body);
    const item = await kit.dataSource
      .getRepository(RentalItem)
      .findOneByOrFail({ rentalId: booking.rentalId });
    expect(item.returnedAt).toBeNull();
    expect(item.releasedAt).toBeInstanceOf(Date);
    expect(await balance()).toBe(10000);
    await post().set('Idempotency-Key', randomUUID()).send(input).expect(201);
  });

  it('returns ACTIVE or OVERDUE rentals, releases the copy and refuses cancellation after issue', async () => {
    const { booking, input } = await book();
    await command(booking.rentalId, 'issue').expect(200);
    await command(booking.rentalId, 'cancel').send({ reason: 'Too late' }).expect(409);
    await kit.dataSource.getRepository(Rental).update(booking.rentalId, { status: 'OVERDUE' });
    const first = await command(booking.rentalId, 'return').expect(200);
    expect(first.body).toMatchObject({ status: 'RETURNED' });
    expect((first.body as Detail).items[0].returnedAt).toBeTruthy();
    expect((first.body as Detail).items[0].releasedAt).toBe(
      (first.body as Detail).items[0].returnedAt,
    );
    const again = await command(booking.rentalId, 'return').expect(200);
    expect(again.body).toEqual(first.body);
    expect(await balance()).toBe(7500);
    await command(booking.rentalId, 'issue').expect(409);
    await post().set('Idempotency-Key', randomUUID()).send(input).expect(201);
  });

  it('returns outstanding legacy items while preserving earlier partial-return dates', async () => {
    const { catalogFixture, renter } = await fixture();
    const dataSource = kit.dataSource;
    const secondCopy = await dataSource.getRepository(GameCopy).save({
      ...catalogFixture.copy,
      gameCopyId: randomUUID(),
    });
    const rental = await dataSource.getRepository(Rental).save(aRental(renter.renterId));
    const earlierReturn = new Date('2020-01-02T12:00:00.000Z');
    await dataSource
      .getRepository(RentalItem)
      .save([
        aRentalItem(rental.rentalId, catalogFixture.copy.gameCopyId, { returnedAt: earlierReturn }),
        aRentalItem(rental.rentalId, secondCopy.gameCopyId),
      ]);
    const response = await command(rental.rentalId, 'return').expect(200);
    expect((response.body as Detail).status).toBe('RETURNED');
    const items = await dataSource.getRepository(RentalItem).findBy({ rentalId: rental.rentalId });
    const previouslyReturned = items.find(
      item => item.gameCopyId === catalogFixture.copy.gameCopyId,
    );
    const justReturned = items.find(item => item.gameCopyId === secondCopy.gameCopyId);
    expect(previouslyReturned?.returnedAt).toEqual(earlierReturn);
    expect(previouslyReturned?.releasedAt).toEqual(earlierReturn);
    expect(justReturned?.returnedAt?.getTime()).toBeGreaterThan(earlierReturn.getTime());
    expect(justReturned?.releasedAt).toEqual(justReturned?.returnedAt);
    expect(await balance()).toBe(10000);
    const repeat = await command(rental.rentalId, 'return').expect(200);
    expect(repeat.body).toEqual(response.body);
  });

  it('enforces staff and owner access plus command validation', async () => {
    const { booking } = await book();
    await command(booking.rentalId, 'issue', clientAuthorization).expect(403);
    await command(booking.rentalId, 'return', clientAuthorization).expect(403);
    await command(booking.rentalId, 'cancel', otherAuthorization)
      .send({ reason: 'Forged' })
      .expect(403);
    await command(booking.rentalId, 'cancel').send({ reason: '   ' }).expect(400);
    await command(booking.rentalId, 'cancel')
      .send({ reason: 'ok', cancelledBy: 'forged' })
      .expect(400);
    await command('not-a-uuid', 'issue').expect(400);
    await command(randomUUID(), 'issue').expect(404);
    await command(booking.rentalId, 'return').expect(409);
  });

  it('refuses expired bookings before the scheduler runs', async () => {
    const { booking } = await book();
    await kit.dataSource.query(
      `UPDATE rentals SET booked_at = clock_timestamp() - interval '2 days',
      booking_expires_at = clock_timestamp() - interval '1 day' WHERE rental_id = $1`,
      [booking.rentalId],
    );
    await command(booking.rentalId, 'issue').expect(409);
    expect(await balance()).toBe(10000);
    await command(booking.rentalId, 'cancel').send({ reason: 'Not collected' }).expect(200);
  });

  it('serializes issue versus cancel and spends the balance only if issue wins', async () => {
    const { booking } = await book();
    const responses = await Promise.all([
      command(booking.rentalId, 'issue'),
      command(booking.rentalId, 'cancel', clientAuthorization).send({ reason: 'Changed plans' }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const rental = await kit.dataSource
      .getRepository(Rental)
      .findOneByOrFail({ rentalId: booking.rentalId });
    expect(['ACTIVE', 'CANCELLED']).toContain(rental.status);
    expect(await balance()).toBe(rental.status === 'ACTIVE' ? 7500 : 10000);
  });

  it('replays the booking receipt after issue without booking or charging again', async () => {
    const { input } = await fixture();
    const key = randomUUID();
    const first = await post().set('Idempotency-Key', key).send(input).expect(201);
    await command((first.body as Booking).rentalId, 'issue').expect(200);
    const replay = await post().set('Idempotency-Key', key).send(input).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.get('Idempotency-Replay')).toBe('true');
    expect(await kit.dataSource.getRepository(Rental).count()).toBe(1);
    expect(await balance()).toBe(7500);
  });

  it('allows only one of two concurrent bookings of a single copy', async () => {
    const { input } = await fixture();
    const responses = await Promise.all([
      post().set('Idempotency-Key', randomUUID()).send(input),
      post().set('Idempotency-Key', randomUUID()).send(input),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await kit.dataSource.getRepository(Rental).count()).toBe(1);
    expect(await kit.dataSource.getRepository(RentalRequest).count()).toBe(1);
    expect(await balance()).toBe(10000);
  });

  it('does not spend one balance twice when issuing two different bookings concurrently', async () => {
    const { input, catalogFixture } = await fixture(2500);
    await kit.dataSource
      .getRepository(GameCopy)
      .save({ ...catalogFixture.copy, gameCopyId: randomUUID() });
    const first = await post().set('Idempotency-Key', randomUUID()).send(input).expect(201);
    const second = await post().set('Idempotency-Key', randomUUID()).send(input).expect(201);
    const responses = await Promise.all([
      command((first.body as Booking).rentalId, 'issue'),
      command((second.body as Booking).rentalId, 'issue'),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await balance()).toBe(0);
    expect(await kit.dataSource.getRepository(Rental).countBy({ status: 'ACTIVE' })).toBe(1);
    expect(await kit.dataSource.getRepository(Rental).countBy({ status: 'BOOKED' })).toBe(1);
  });

  it('rolls back the debit if saving the issued status fails', async () => {
    const { booking } = await book();
    const dataSource = kit.dataSource;
    await dataSource.query(`CREATE FUNCTION fail_test_issue() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status = 'ACTIVE' THEN RAISE EXCEPTION 'Injected issue failure'; END IF; RETURN NEW; END $$`);
    await dataSource.query(
      `CREATE TRIGGER fail_test_issue BEFORE UPDATE ON rentals FOR EACH ROW EXECUTE FUNCTION fail_test_issue()`,
    );
    try {
      const response = await command(booking.rentalId, 'issue').expect(500);
      expect(response.body).toMatchObject({ detail: 'Internal server error' });
      expect(await balance()).toBe(10000);
      expect(
        await dataSource.getRepository(Rental).findOneByOrFail({ rentalId: booking.rentalId }),
      ).toMatchObject({ status: 'BOOKED', rentedAt: null });
    } finally {
      await dataSource.query('DROP TRIGGER fail_test_issue ON rentals');
      await dataSource.query('DROP FUNCTION fail_test_issue()');
    }
    await command(booking.rentalId, 'issue').expect(200);
    expect(await balance()).toBe(7500);
  });

  it('rolls back issue and debit if its email cannot be enqueued', async () => {
    const { booking } = await book();
    const dataSource = kit.dataSource;
    await dataSource.query(`CREATE FUNCTION fail_test_email() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.notification_status = 'ACTIVE' THEN RAISE EXCEPTION 'Injected enqueue failure'; END IF; RETURN NEW; END $$`);
    await dataSource.query(
      'CREATE TRIGGER fail_test_email BEFORE INSERT ON rental_jobs FOR EACH ROW EXECUTE FUNCTION fail_test_email()',
    );
    try {
      await command(booking.rentalId, 'issue').expect(500);
      expect(await balance()).toBe(10000);
      expect(
        await dataSource.getRepository(Rental).findOneByOrFail({ rentalId: booking.rentalId }),
      ).toMatchObject({ status: 'BOOKED', rentedAt: null });
      expect(await dataSource.getRepository(RentalJob).count()).toBe(1);
    } finally {
      await dataSource.query('DROP TRIGGER fail_test_email ON rental_jobs');
      await dataSource.query('DROP FUNCTION fail_test_email()');
    }
    await command(booking.rentalId, 'issue').expect(200);
    expect(await balance()).toBe(7500);
    expect(await dataSource.getRepository(RentalJob).count()).toBe(2);
  });

  it('rechecks expiry after waiting for the renter balance lock', async () => {
    const { booking } = await book();
    const dataSource = kit.dataSource;
    const writer = dataSource.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    let pending: Promise<{ status: number }> | undefined;
    try {
      await writer.query('SELECT renter_id FROM renters WHERE renter_id = $1 FOR NO KEY UPDATE', [
        clientPrincipal.renterId,
      ]);
      await dataSource.query(
        "UPDATE rentals SET booking_expires_at = clock_timestamp() + interval '1 second' WHERE rental_id = $1",
        [booking.rentalId],
      );
      pending = command(booking.rentalId, 'issue').then(response => response);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await dataSource.query<
          { waiting: boolean }[]
        >(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%FOR NO KEY UPDATE%') AS waiting`);
        if (row.waiting) {
          waiting = true;
          break;
        }
        await delay(10);
      }
      expect(waiting).toBe(true);
      let expired = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        const [row] = await dataSource.query<{ expired: boolean }[]>(
          'SELECT clock_timestamp() >= booking_expires_at AS expired FROM rentals WHERE rental_id = $1',
          [booking.rentalId],
        );
        if (row.expired) {
          expired = true;
          break;
        }
        await delay(10);
      }
      expect(expired).toBe(true);
      await writer.commitTransaction();
      expect((await pending).status).toBe(409);
      expect(await balance()).toBe(10000);
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
      await pending;
    }
  });

  it('does not reinterpret or discard a legacy checkout receipt', async () => {
    const { input } = await fixture();
    const key = randomUUID();
    const receipt = {
      rentalId: randomUUID(),
      gameCopyId: randomUUID(),
      chargedAmount: 2500,
      balance: 7500,
    };
    await kit.dataSource
      .getRepository(RentalRequest)
      .save({ idempotencyKey: key, requestHash: 'legacy', response: receipt });
    await post().set('Idempotency-Key', key).send(input).expect(409);
    expect(
      (await kit.dataSource.getRepository(RentalRequest).findOneByOrFail({ idempotencyKey: key }))
        .response,
    ).toEqual(receipt);
    expect(await kit.dataSource.getRepository(Rental).count()).toBe(0);
  });
});
