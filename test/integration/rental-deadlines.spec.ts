import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
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
import { RentalsRepository } from '../../src/rentals/rentals.repository';
import { BOOKING_EXPIRY_REASON } from '../../src/rentals/rental-deadlines';
import { ExpireBooking } from '../../src/rentals/use-cases/expire-booking';
import { MarkRentalOverdue } from '../../src/rentals/use-cases/mark-rental-overdue';
import {
  ProcessRentalDeadlines,
  DEADLINE_BATCH_SIZE,
} from '../../src/rentals/use-cases/process-rental-deadlines';
import { IssueRental } from '../../src/rentals/use-cases/issue-rental';
import { CancelRental } from '../../src/rentals/use-cases/cancel-rental';
import { ReturnRental } from '../../src/rentals/use-cases/return-rental';
import { aCatalog, aRenter, aRental, aRentalItem } from './testkit/builders';
import { staffPrincipal } from './testkit/auth';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';

describe('Rental deadline processing (PostgreSQL)', () => {
  let kit: PostgresTestkit;
  let stopPostgres: (() => Promise<void>) | undefined;
  let rentalsRepository: RentalsRepository;
  let expireBookingUseCase: ExpireBooking;
  let markRentalOverdueUseCase: MarkRentalOverdue;
  let processRentalDeadlinesUseCase: ProcessRentalDeadlines;
  beforeAll(async () => {
    kit = await startPostgres();
    stopPostgres = () => kit.stop();
    rentalsRepository = new RentalsRepository(kit.dataSource);
    expireBookingUseCase = new ExpireBooking(kit.dataSource, rentalsRepository);
    markRentalOverdueUseCase = new MarkRentalOverdue(kit.dataSource, rentalsRepository);
    processRentalDeadlinesUseCase = new ProcessRentalDeadlines(
      kit.dataSource,
      rentalsRepository,
      expireBookingUseCase,
      markRentalOverdueUseCase,
    );
  });
  beforeEach(async () => kit.reset());
  afterAll(async () => stopPostgres?.());

  async function fixture(status: 'BOOKED' | 'ACTIVE' | 'RETURNED' = 'BOOKED', expired = true) {
    const dataSource = kit.dataSource;
    const catalogFixture = aCatalog();
    await dataSource.getRepository(Game).save(catalogFixture.game);
    await dataSource.getRepository(Platform).save(catalogFixture.platform);
    await dataSource.getRepository(GamePlatform).save(catalogFixture.gamePlatform);
    await dataSource.getRepository(GameCopy).save(catalogFixture.copy);
    const renter = await dataSource.getRepository(Renter).save(aRenter());
    const deadline = new Date(expired ? '2020-01-02T12:00:00Z' : '2099-01-02T12:00:00Z');
    const rental = await dataSource.getRepository(Rental).save({
      ...aRental(renter.renterId),
      status,
      ...(status === 'BOOKED'
        ? {
            bookedAt: new Date('2020-01-01T12:00:00Z'),
            bookingExpiresAt: deadline,
            rentedAt: null,
            dueAt: null,
          }
        : { dueAt: deadline }),
    });
    await dataSource
      .getRepository(RentalItem)
      .save(
        aRentalItem(
          rental.rentalId,
          catalogFixture.copy.gameCopyId,
          status === 'RETURNED' ? { returnedAt: new Date('2020-01-03T12:00:00Z') } : {},
        ),
      );
    return { rental, renter, catalogFixture };
  }
  const readRental = (rentalId: string) =>
    kit.dataSource.getRepository(Rental).findOneByOrFail({ rentalId });

  it('expires a booking once, records a system reason, frees its copy without return/refund, and queues cancellation email', async () => {
    const { rental, renter, catalogFixture } = await fixture();
    expect(await expireBookingUseCase.execute(rental.rentalId)).toBe(true);
    const cancelledRental = await readRental(rental.rentalId);
    expect(cancelledRental).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: null,
      cancellationReason: BOOKING_EXPIRY_REASON,
      rentedAt: null,
    });
    const rentalItem = await kit.dataSource
      .getRepository(RentalItem)
      .findOneByOrFail({ rentalId: rental.rentalId });
    expect(rentalItem.returnedAt).toBeNull();
    expect(rentalItem.releasedAt).toEqual(cancelledRental.cancelledAt);
    expect(await expireBookingUseCase.execute(rental.rentalId)).toBe(false);
    expect(await readRental(rental.rentalId)).toEqual(cancelledRental);
    expect(
      (await kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: renter.renterId }))
        .balance,
    ).toBe(renter.balance);
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(1);
    const availableCopy = await kit.dataSource.transaction(manager =>
      rentalsRepository.findAvailableCopyForUpdate(
        manager,
        catalogFixture.game.gameId,
        catalogFixture.platform.platformId,
      ),
    );
    expect(availableCopy?.gameCopyId).toBe(catalogFixture.copy.gameCopyId);
  });

  it('marks overdue once without changing issue/due dates, balance or physical possession', async () => {
    const { rental, renter } = await fixture('ACTIVE');
    expect(await markRentalOverdueUseCase.execute(rental.rentalId)).toBe(true);
    const overdueRental = await readRental(rental.rentalId);
    expect(overdueRental).toMatchObject({
      status: 'OVERDUE',
      rentedAt: rental.rentedAt,
      dueAt: rental.dueAt,
    });
    expect(await markRentalOverdueUseCase.execute(rental.rentalId)).toBe(false);
    expect(await readRental(rental.rentalId)).toEqual(overdueRental);
    expect(
      await kit.dataSource.getRepository(RentalItem).findOneByOrFail({ rentalId: rental.rentalId }),
    ).toMatchObject({ returnedAt: null, releasedAt: null });
    expect(
      (await kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: renter.renterId }))
        .balance,
    ).toBe(renter.balance);
  });

  it('ignores future, terminal, wrong-action and missing rentals', async () => {
    const booking = await fixture('BOOKED', false);
    const active = await fixture('ACTIVE', false);
    const returned = await fixture('RETURNED');
    for (const rentalId of [
      booking.rental.rentalId,
      active.rental.rentalId,
      returned.rental.rentalId,
      randomUUID(),
    ]) {
      expect(await expireBookingUseCase.execute(rentalId)).toBe(false);
      expect(await markRentalOverdueUseCase.execute(rentalId)).toBe(false);
    }
    expect(await processRentalDeadlinesUseCase.execute()).toEqual({
      expiredBookings: 0,
      overdueRentals: 0,
      failedRentals: 0,
    });
  });

  it('allows only one real transition across simultaneous service instances', async () => {
    const booking = await fixture();
    const active = await fixture('ACTIVE');
    const anotherExpiry = new ExpireBooking(kit.dataSource, new RentalsRepository(kit.dataSource));
    const anotherOverdue = new MarkRentalOverdue(
      kit.dataSource,
      new RentalsRepository(kit.dataSource),
    );
    expect(
      (
        await Promise.all([
          expireBookingUseCase.execute(booking.rental.rentalId),
          anotherExpiry.execute(booking.rental.rentalId),
        ])
      ).sort(),
    ).toEqual([false, true]);
    expect(
      (
        await Promise.all([
          markRentalOverdueUseCase.execute(active.rental.rentalId),
          anotherOverdue.execute(active.rental.rentalId),
        ])
      ).sort(),
    ).toEqual([false, true]);
  });

  it('processes each transition once when two full deadline scans overlap', async () => {
    await fixture();
    await fixture('ACTIVE');
    const anotherProcessor = new ProcessRentalDeadlines(
      kit.dataSource,
      new RentalsRepository(kit.dataSource),
      new ExpireBooking(kit.dataSource, new RentalsRepository(kit.dataSource)),
      new MarkRentalOverdue(kit.dataSource, new RentalsRepository(kit.dataSource)),
    );
    const scanResults = await Promise.all([
      processRentalDeadlinesUseCase.execute(),
      anotherProcessor.execute(),
    ]);
    expect(scanResults.reduce((total, scan) => total + scan.expiredBookings, 0)).toBe(1);
    expect(scanResults.reduce((total, scan) => total + scan.overdueRentals, 0)).toBe(1);
    expect(scanResults.reduce((total, scan) => total + scan.failedRentals, 0)).toBe(0);
  });

  it('serializes expiry with manual cancellation and retains the winning actor/reason', async () => {
    const { rental } = await fixture();
    const cancelRentalUseCase = new CancelRental(kit.dataSource, rentalsRepository);
    const [expired] = await Promise.all([
      expireBookingUseCase.execute(rental.rentalId),
      cancelRentalUseCase.execute(rental.rentalId, staffPrincipal, 'Cancelled at desk'),
    ]);
    const cancelledRental = await readRental(rental.rentalId);
    expect(cancelledRental.status).toBe('CANCELLED');
    expect(cancelledRental.cancelledBy).toBe(expired ? null : staffPrincipal.id);
    expect(cancelledRental.cancellationReason).toBe(
      expired ? BOOKING_EXPIRY_REASON : 'Cancelled at desk',
    );
  });

  it('never charges an expired booking racing with physical issue', async () => {
    const { rental, renter } = await fixture();
    const issueRentalUseCase = new IssueRental(kit.dataSource, rentalsRepository);
    const [issueOutcome, expiryOutcome] = await Promise.allSettled([
      issueRentalUseCase.execute(rental.rentalId, staffPrincipal),
      expireBookingUseCase.execute(rental.rentalId),
    ]);
    expect(issueOutcome.status).toBe('rejected');
    expect(expiryOutcome).toEqual({ status: 'fulfilled', value: true });
    expect((await readRental(rental.rentalId)).status).toBe('CANCELLED');
    expect(
      (await kit.dataSource.getRepository(Renter).findOneByOrFail({ renterId: renter.renterId }))
        .balance,
    ).toBe(renter.balance);
  });

  it('keeps RETURNED final when physical return races with overdue processing', async () => {
    const { rental } = await fixture('ACTIVE');
    const returnRentalUseCase = new ReturnRental(kit.dataSource, rentalsRepository);
    await Promise.all([
      markRentalOverdueUseCase.execute(rental.rentalId),
      returnRentalUseCase.execute(rental.rentalId, staffPrincipal),
    ]);
    expect((await readRental(rental.rentalId)).status).toBe('RETURNED');
    expect(await markRentalOverdueUseCase.execute(rental.rentalId)).toBe(false);
    expect(
      (
        await kit.dataSource
          .getRepository(RentalItem)
          .findOneByOrFail({ rentalId: rental.rentalId })
      ).releasedAt,
    ).toBeInstanceOf(Date);
  });

  it('rechecks deadlines after waiting for a locked row whose due date changed', async () => {
    const { rental } = await fixture('ACTIVE');
    const writer = kit.dataSource.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    let pending: Promise<boolean> | undefined;
    try {
      await writer.query("UPDATE rentals SET due_at = '2099-01-01' WHERE rental_id = $1", [
        rental.rentalId,
      ]);
      pending = markRentalOverdueUseCase.execute(rental.rentalId);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await kit.dataSource.query<{ waiting: boolean }[]>(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%') AS waiting`,
        );
        if (row.waiting) {
          waiting = true;
          break;
        }
        await delay(10);
      }
      expect(waiting).toBe(true);
      await writer.commitTransaction();
      expect(await pending).toBe(false);
      expect((await readRental(rental.rentalId)).status).toBe('ACTIVE');
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
      await pending;
    }
  });

  it('catches up in multiple bounded pages, preserving microsecond cursor precision', async () => {
    const { rental, catalogFixture } = await fixture();
    const rentals = Array.from({ length: DEADLINE_BATCH_SIZE }, () => ({
      rentalId: randomUUID(),
      renterId: rental.renterId,
      status: 'BOOKED' as const,
      bookedAt: rental.bookedAt,
      bookingExpiresAt: rental.bookingExpiresAt,
      rentedAt: null,
      dueAt: null,
    }));
    const copies = rentals.map(() => ({ ...catalogFixture.copy, gameCopyId: randomUUID() }));
    await kit.dataSource.getRepository(GameCopy).save(copies);
    await kit.dataSource.getRepository(Rental).save(rentals);
    await kit.dataSource
      .getRepository(RentalItem)
      .save(
        rentals.map((bookedRental, index) =>
          aRentalItem(bookedRental.rentalId, copies[index].gameCopyId),
        ),
      );
    await kit.dataSource.query(
      "UPDATE rentals SET booking_expires_at = '2020-01-02 12:00:00.123456+00'",
    );
    const cutoff = await rentalsRepository.currentTime(kit.dataSource.manager);
    const firstPage = await rentalsRepository.findDeadlineCandidates(
      'BOOKED',
      cutoff,
      DEADLINE_BATCH_SIZE,
    );
    const secondPage = await rentalsRepository.findDeadlineCandidates(
      'BOOKED',
      cutoff,
      DEADLINE_BATCH_SIZE,
      firstPage[firstPage.length - 1],
    );
    expect(firstPage).toHaveLength(DEADLINE_BATCH_SIZE);
    expect(secondPage).toHaveLength(1);
    expect(new Set([...firstPage, ...secondPage].map(candidate => candidate.rentalId)).size).toBe(
      DEADLINE_BATCH_SIZE + 1,
    );
    expect(await processRentalDeadlinesUseCase.execute()).toEqual({
      expiredBookings: DEADLINE_BATCH_SIZE + 1,
      overdueRentals: 0,
      failedRentals: 0,
    });
    expect(await kit.dataSource.getRepository(Rental).countBy({ status: 'CANCELLED' })).toBe(
      DEADLINE_BATCH_SIZE + 1,
    );
    const restartedProcessor = new ProcessRentalDeadlines(
      kit.dataSource,
      new RentalsRepository(kit.dataSource),
      expireBookingUseCase,
      markRentalOverdueUseCase,
    );
    expect(await restartedProcessor.execute()).toEqual({
      expiredBookings: 0,
      overdueRentals: 0,
      failedRentals: 0,
    });
  });

  it('rolls back a failed cancellation, continues other rows and retries the failure next run', async () => {
    const failedBooking = await fixture();
    const healthyBooking = await fixture();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await kit.dataSource.query(
      `CREATE FUNCTION reject_deadline_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected deadline failure'; END $$`,
    );
    await kit.dataSource.query(
      `CREATE TRIGGER reject_deadline_cancel BEFORE UPDATE ON rentals FOR EACH ROW WHEN (NEW.rental_id = '${failedBooking.rental.rentalId}'::uuid AND NEW.status = 'CANCELLED') EXECUTE FUNCTION reject_deadline_cancel()`,
    );
    try {
      expect(await processRentalDeadlinesUseCase.execute()).toEqual({
        expiredBookings: 1,
        overdueRentals: 0,
        failedRentals: 1,
      });
      expect((await readRental(failedBooking.rental.rentalId)).status).toBe('BOOKED');
      expect((await readRental(healthyBooking.rental.rentalId)).status).toBe('CANCELLED');
      expect(
        (
          await kit.dataSource
            .getRepository(RentalItem)
            .findOneByOrFail({ rentalId: failedBooking.rental.rentalId })
        ).releasedAt,
      ).toBeNull();
    } finally {
      await kit.dataSource.query('DROP TRIGGER reject_deadline_cancel ON rentals');
      await kit.dataSource.query('DROP FUNCTION reject_deadline_cancel()');
      errorLog.mockRestore();
    }
    expect(await processRentalDeadlinesUseCase.execute()).toEqual({
      expiredBookings: 1,
      overdueRentals: 0,
      failedRentals: 0,
    });
  });

  it('can use the existing partial deadline indexes for both candidate searches', async () => {
    await fixture();
    await fixture('ACTIVE');
    await kit.dataSource.transaction(async manager => {
      await manager.query('SET LOCAL enable_seqscan = off');
      for (const [status, deadlineColumn, indexName] of [
        ['BOOKED', 'booking_expires_at', 'idx_rentals_booking_expiry'],
        ['ACTIVE', 'due_at', 'idx_rentals_due'],
      ]) {
        const plan = await manager.query<unknown[]>(
          `EXPLAIN SELECT rental_id FROM rentals WHERE status = $1 AND ${deadlineColumn} <= now() ORDER BY ${deadlineColumn}, rental_id LIMIT 100`,
          [status],
        );
        expect(JSON.stringify(plan)).toContain(indexName);
      }
    });
  });
});
