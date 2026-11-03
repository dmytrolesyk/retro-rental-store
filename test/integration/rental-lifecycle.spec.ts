import { staffPrincipal } from './testkit/auth';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Game, GameCopy, GamePlatform, Platform, Renter } from '../../src/database/entities';
import { RentalsRepository } from '../../src/rentals/rentals.repository';
import { checkout } from '../../src/rentals/checkout';
import { RentalsService } from '../../src/rentals/rentals.service';
import { aCatalog, aRenter } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';

interface RentalRow {
  rental_id: string;
  status: string;
  rented_at: Date;
  due_at: Date;
  booked_at: Date | null;
}
interface ItemRow {
  returned_at: Date | null;
  released_at: Date | null;
}

const start = new Date('2026-01-01T12:00:00Z');
const nextDay = new Date('2026-01-02T12:00:00Z');

describe('Rental lifecycle schema (PostgreSQL)', () => {
  let kit: PostgresTestkit;
  beforeAll(async () => {
    kit = await startPostgres();
  });
  beforeEach(async () => {
    await kit.reset();
  });
  afterAll(async () => {
    await kit.stop();
  });

  async function fixture() {
    const dataSource = kit.dataSource;
    const renter = await dataSource.getRepository(Renter).save(aRenter());
    const catalog = aCatalog();
    await dataSource.getRepository(Game).save(catalog.game);
    await dataSource.getRepository(Platform).save(catalog.platform);
    await dataSource.getRepository(GamePlatform).save(catalog.gamePlatform);
    await dataSource.getRepository(GameCopy).save(catalog.copy);
    return { renter, catalog };
  }

  async function book(renterId: string, copyId: string) {
    const rentalId = randomUUID();
    await kit.dataSource.query(
      `INSERT INTO rentals
      (rental_id, renter_id, status, booked_at, booking_expires_at)
      VALUES ($1, $2, 'BOOKED', $3, $4)`,
      [rentalId, renterId, start, nextDay],
    );
    await kit.dataSource.query(
      `INSERT INTO rental_items (rental_id, game_copy_id, cost_per_day)
      VALUES ($1, $2, 2500)`,
      [rentalId, copyId],
    );
    return rentalId;
  }

  it('books without an issue date, holds the copy, and releases a cancellation without a fake return', async () => {
    const { renter, catalog } = await fixture();
    const id = await book(renter.renterId, catalog.copy.gameCopyId);
    const [booked] = await kit.dataSource.query<RentalRow[]>(
      'SELECT * FROM rentals WHERE rental_id = $1',
      [id],
    );
    expect(booked).toMatchObject({ status: 'BOOKED', rented_at: null, due_at: null });
    const repository = new RentalsRepository(kit.dataSource);
    await kit.dataSource.transaction(async manager => {
      expect(
        await repository.findAvailableCopyForUpdate(
          manager,
          catalog.game.gameId,
          catalog.platform.platformId,
        ),
      ).toBeUndefined();
    });
    await kit.dataSource.query(
      `UPDATE rentals SET status = 'CANCELLED', cancelled_at = $2,
      cancellation_reason = 'client_cancelled' WHERE rental_id = $1`,
      [id, new Date('2026-01-01T13:00:00Z')],
    );
    const [item] = await kit.dataSource.query<ItemRow[]>(
      'SELECT * FROM rental_items WHERE rental_id = $1',
      [id],
    );
    expect(item.returned_at).toBeNull();
    expect(item.released_at).toEqual(new Date('2026-01-01T13:00:00Z'));
    await kit.dataSource.transaction(async manager => {
      expect(
        await repository.findAvailableCopyForUpdate(
          manager,
          catalog.game.gameId,
          catalog.platform.platformId,
        ),
      ).toMatchObject({ gameCopyId: catalog.copy.gameCopyId });
    });
    await expect(book(renter.renterId, catalog.copy.gameCopyId)).resolves.toEqual(
      expect.any(String),
    );
  });

  it('serializes concurrent claims for the same physical copy', async () => {
    const { renter, catalog } = await fixture();
    const results = await Promise.allSettled([
      book(renter.renterId, catalog.copy.gameCopyId),
      book(renter.renterId, catalog.copy.gameCopyId),
    ]);
    expect(results.filter(checkoutReceipt => checkoutReceipt.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(checkoutReceipt => checkoutReceipt.status === 'rejected')).toHaveLength(
      1,
    );
    const [row] = await kit.dataSource.query<{ count: number }[]>(
      'SELECT count(*)::int AS count FROM rental_items WHERE released_at IS NULL',
    );
    expect(row.count).toBe(1);
  });

  it('reads an unissued booking without inventing a rentedAt date', async () => {
    const { renter, catalog } = await fixture();
    const id = await book(renter.renterId, catalog.copy.gameCopyId);
    const service = new RentalsService(kit.dataSource, new RentalsRepository(kit.dataSource));
    await expect(service.get(id, staffPrincipal)).resolves.toMatchObject({
      rentalId: id,
      rentedAt: null,
    });
  });

  it('rejects a second hold and manual release while a booking is live', async () => {
    const { renter, catalog } = await fixture();
    const id = await book(renter.renterId, catalog.copy.gameCopyId);
    await expect(book(renter.renterId, catalog.copy.gameCopyId)).rejects.toMatchObject({
      driverError: { code: '23505' },
    });
    await kit.dataSource.query('UPDATE rental_items SET released_at = $2 WHERE rental_id = $1', [
      id,
      nextDay,
    ]);
    const [item] = await kit.dataSource.query<ItemRow[]>(
      'SELECT released_at FROM rental_items WHERE rental_id = $1',
      [id],
    );
    expect(item.released_at).toBeNull();
    await expect(
      kit.dataSource.query('UPDATE rental_items SET returned_at = $2 WHERE rental_id = $1', [
        id,
        nextDay,
      ]),
    ).rejects.toThrow();
  });

  it('enforces valid status/date combinations and disallows cancelling an issued rental', async () => {
    const { renter, catalog } = await fixture();
    const id = await book(renter.renterId, catalog.copy.gameCopyId);
    for (const sql of [
      "status = 'PENDING'",
      'booking_expires_at = booked_at',
      "status = 'ACTIVE'",
      "status = 'CANCELLED', cancelled_at = booked_at",
    ]) {
      await expect(
        kit.dataSource.query(`UPDATE rentals SET ${sql} WHERE rental_id = $1`, [id]),
      ).rejects.toThrow();
    }
    await kit.dataSource.query(
      `UPDATE rentals SET status = 'ACTIVE', rented_at = $2,
      due_at = $3 WHERE rental_id = $1`,
      [id, new Date('2026-01-01T13:00:00Z'), new Date('2026-01-02T13:00:00Z')],
    );
    await expect(
      kit.dataSource.query("UPDATE rentals SET status = 'RETURNED' WHERE rental_id = $1", [id]),
    ).rejects.toThrow();
    await expect(
      kit.dataSource.query(
        `UPDATE rentals SET status = 'CANCELLED',
      cancelled_at = $2, cancellation_reason = 'staff_cancelled' WHERE rental_id = $1`,
        [id, nextDay],
      ),
    ).rejects.toThrow();
  });

  it('legacy checkout creates ACTIVE dates and physical returns release the copy', async () => {
    const { renter, catalog } = await fixture();
    const checkoutReceipt = await checkout(kit.dataSource, {
      renterId: renter.renterId,
      gameId: catalog.game.gameId,
      platformId: catalog.platform.platformId,
    });
    const [rental] = await kit.dataSource.query<RentalRow[]>(
      'SELECT * FROM rentals WHERE rental_id = $1',
      [checkoutReceipt.rentalId],
    );
    expect(rental.status).toBe('ACTIVE');
    expect(rental.rented_at).toBeInstanceOf(Date);
    expect(rental.due_at.getTime() - rental.rented_at.getTime()).toBe(86400000);
    const returned = new Date(rental.rented_at.getTime() + 1000);
    await kit.dataSource.query('UPDATE rental_items SET returned_at = $2 WHERE rental_id = $1', [
      checkoutReceipt.rentalId,
      returned,
    ]);
    const [item] = await kit.dataSource.query<ItemRow[]>(
      'SELECT * FROM rental_items WHERE rental_id = $1',
      [checkoutReceipt.rentalId],
    );
    expect(item.released_at).toEqual(returned);
    // Existing date triggers must still reject impossible physical histories.
    await expect(
      kit.dataSource.query('UPDATE rentals SET rented_at = $2 WHERE rental_id = $1', [
        checkoutReceipt.rentalId,
        new Date(returned.getTime() + 1000),
      ]),
    ).rejects.toThrow();
  });

  it('migrates existing active, fully returned, and partially returned histories without losing dates', async () => {
    const dataSource = kit.dataSource;
    await dataSource.undoLastMigration();
    try {
      const { renter, catalog } = await fixture();
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const otherCopy = randomUUID();
      await dataSource.query(
        `INSERT INTO game_copies SELECT $1, game_id, platform_id, photo_url,
        condition, format, price_per_day FROM game_copies WHERE game_copy_id = $2`,
        [otherCopy, catalog.copy.gameCopyId],
      );
      for (const id of ids)
        await dataSource.query(
          'INSERT INTO rentals (rental_id, renter_id, rented_at) VALUES ($1,$2,$3)',
          [id, renter.renterId, start],
        );
      await dataSource.query(
        `INSERT INTO rental_items (rental_id, game_copy_id, cost_per_day, returned_at)
        VALUES ($1,$4,2500,$6), ($2,$4,2500,NULL), ($3,$5,2500,NULL), ($3,$4,2500,$6)`,
        [...ids, catalog.copy.gameCopyId, otherCopy, nextDay],
      );
      await dataSource.runMigrations();
      const rows = await dataSource.query<RentalRow[]>('SELECT * FROM rentals ORDER BY rental_id');
      for (const id of ids) {
        const row = rows.find((r: { rental_id: string }) => r.rental_id === id);
        expect(row).toMatchObject({
          status: id === ids[0] ? 'RETURNED' : 'ACTIVE',
          rented_at: start,
          booked_at: null,
          booking_expires_at: null,
          due_at: nextDay,
        });
      }
      const items = await dataSource.query<ItemRow[]>(
        'SELECT returned_at, released_at FROM rental_items',
      );
      expect(items).toHaveLength(4);
      for (const item of items) expect(item.released_at).toEqual(item.returned_at);
      await dataSource.undoLastMigration();
      expect(
        (await dataSource.query<{ rented_at: Date }[]>('SELECT rented_at FROM rentals')).map(
          (r: { rented_at: Date }) => r.rented_at,
        ),
      ).toEqual([start, start, start]);
      await dataSource.runMigrations();
    } finally {
      await dataSource.runMigrations();
    }
  });

  it('refuses a lossy rollback after bookings exist', async () => {
    const { renter, catalog } = await fixture();
    await book(renter.renterId, catalog.copy.gameCopyId);
    await expect(kit.dataSource.undoLastMigration()).rejects.toThrow();
    const [row] = await kit.dataSource.query<{ status: string }[]>('SELECT status FROM rentals');
    expect(row.status).toBe('BOOKED');
  });

  it('checks rollback safety after waiting for concurrent booking writes', async () => {
    const dataSource = kit.dataSource;
    const { renter } = await fixture();
    const writer = dataSource.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    let rollback: Promise<boolean> | undefined;
    try {
      await writer.query(
        `INSERT INTO rentals
        (renter_id, status, booked_at, booking_expires_at, rented_at, due_at)
        VALUES ($1, 'ACTIVE', $2, $3, $4, $5)`,
        [
          renter.renterId,
          start,
          nextDay,
          new Date('2026-01-01T13:00:00Z'),
          new Date('2026-01-02T13:00:00Z'),
        ],
      );
      rollback = dataSource.undoLastMigration().then(
        () => false,
        () => true,
      );
      // Wait for a real DDL lock request, not an assumed transaction interleaving.
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await dataSource.query<{ waiting: boolean }[]>(`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE relation = 'rentals'::regclass
          AND mode = 'AccessExclusiveLock' AND NOT granted) AS waiting`);
        if (row.waiting) {
          waiting = true;
          break;
        }
        await delay(25);
      }
      expect(waiting).toBe(true);
      await writer.commitTransaction();
      expect(await rollback).toBe(true);
      const [row] = await dataSource.query<{ booked_at: Date }[]>('SELECT booked_at FROM rentals');
      expect(row.booked_at).toEqual(start);
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
      await rollback;
      await dataSource.runMigrations();
    }
  });

  it('keeps TypeORM metadata aligned with the migrated schema', async () => {
    const diff = await kit.dataSource.driver.createSchemaBuilder().log();
    // rental_requests has a pre-existing hand-maintained JSON check absent from
    // its entity metadata. This test owns only the lifecycle tables.
    expect(
      diff.upQueries.map(q => q.query).filter(sql => /"(rentals|rental_items)"/.test(sql)),
    ).toEqual([]);
  });
});
