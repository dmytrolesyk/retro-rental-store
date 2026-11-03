import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { PageQuery } from '../common/pagination';
import { Rental } from './entities/rental.entity';
import { RentalRequest } from './entities/rental-request.entity';
import type { BookingReceipt } from './rentals.types';
import { Renter } from '../renters/entities/renter.entity';
import { RentalItem } from './entities/rental-item.entity';
import { RentalJob } from '../jobs/entities/rental-job.entity';
import { rentalNotification } from '../jobs/rental-notification';

interface AvailableCopy {
  gameCopyId: string;
  pricePerDay: number;
}

interface NewCheckout {
  renterId: string;
  gameCopyId: string;
  costPerDay: number;
  emailTo: string;
}

export interface RentalDeadlineCandidate {
  rentalId: string;
  // Preserve PostgreSQL microseconds when advancing the keyset cursor.
  deadlineAt: string;
}

@Injectable()
export class RentalsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async queueStatusEmail(
    manager: EntityManager,
    rentalId: string,
    occurredAt: Date,
  ): Promise<void> {
    const rental = await manager.findOneByOrFail(Rental, { rentalId });
    const renter = await manager.findOneByOrFail(Renter, { renterId: rental.renterId });
    await manager.insert(RentalJob, {
      rentalId,
      emailTo: renter.email,
      notificationStatus: rental.status,
      notification: rentalNotification(rental, occurredAt),
    });
  }

  findRenterForCheckout(manager: EntityManager, renterId: string): Promise<Renter | null> {
    // KEY SHARE prevents deletion until commit, but permits concurrent balance updates.
    return manager.findOne(Renter, {
      select: { renterId: true, email: true },
      where: { renterId },
      lock: { mode: 'for_key_share' },
    });
  }

  async findAvailableCopyForUpdate(
    manager: EntityManager,
    gameId: string,
    platformId: string,
  ): Promise<AvailableCopy | undefined> {
    let previousCopyId: string | null = null;
    let copy: AvailableCopy | undefined;
    do {
      const copies: AvailableCopy[] = await manager.query<AvailableCopy[]>(
        `SELECT c.game_copy_id AS "gameCopyId", c.price_per_day AS "pricePerDay"
         FROM game_copies c
         WHERE c.game_id = $1 AND c.platform_id = $2
           AND ($3::uuid IS NULL OR c.game_copy_id > $3::uuid)
           AND NOT EXISTS (
             SELECT 1 FROM rental_items i
             WHERE i.game_copy_id = c.game_copy_id AND i.released_at IS NULL
           )
         ORDER BY c.game_copy_id
         LIMIT 1
         FOR UPDATE OF c`,
        [gameId, platformId, previousCopyId],
      );
      copy = copies.at(0);
      if (!copy) return undefined;
      previousCopyId = copy.gameCopyId;
      // The SELECT snapshot predates any lock wait. Recheck in a fresh READ
      // COMMITTED statement, then advance in UUID order if this copy was taken.
    } while (
      await manager.existsBy(RentalItem, { gameCopyId: copy.gameCopyId, releasedAt: IsNull() })
    );
    return copy;
  }

  async debitBalance(
    manager: EntityManager,
    renterId: string,
    amount: number,
  ): Promise<number | null> {
    // TypeORM 0.3's raw UPDATE result is [returnedRows, affectedCount].
    const [balances] = await manager.query<[{ balance: number }[], number]>(
      `UPDATE renters SET balance = balance - $1
       WHERE renter_id = $2 AND balance >= $1
       RETURNING balance`,
      [amount, renterId],
    );
    return balances.at(0)?.balance ?? null;
  }

  async saveCheckout(manager: EntityManager, input: NewCheckout) {
    const rental = await manager.save(Rental, { renterId: input.renterId, rentedAt: new Date() });
    await manager.insert(RentalItem, {
      rentalId: rental.rentalId,
      gameCopyId: input.gameCopyId,
      costPerDay: input.costPerDay,
    });
    const job = await manager.save(RentalJob, {
      rentalId: rental.rentalId,
      emailTo: input.emailTo,
    });
    return { rentalId: rental.rentalId, jobId: job.jobId };
  }

  async currentTime(manager: EntityManager): Promise<Date> {
    const [row] = await manager.query<{ now: Date }[]>('SELECT clock_timestamp() AS now');
    return row.now;
  }

  async saveBooking(
    manager: EntityManager,
    input: {
      renterId: string;
      gameCopyId: string;
      costPerDay: number;
      bookedAt: Date;
      bookingExpiresAt: Date;
    },
  ): Promise<string> {
    const rental = await manager.save(Rental, {
      renterId: input.renterId,
      status: 'BOOKED',
      bookedAt: input.bookedAt,
      bookingExpiresAt: input.bookingExpiresAt,
      rentedAt: null,
      dueAt: null,
    });
    await manager.insert(RentalItem, {
      rentalId: rental.rentalId,
      gameCopyId: input.gameCopyId,
      costPerDay: input.costPerDay,
    });
    return rental.rentalId;
  }

  findForUpdate(manager: EntityManager, rentalId: string): Promise<Rental | null> {
    return manager.findOne(Rental, { where: { rentalId }, lock: { mode: 'pessimistic_write' } });
  }

  findItemsForUpdate(manager: EntityManager, rentalId: string): Promise<RentalItem[]> {
    return manager
      .getRepository(RentalItem)
      .createQueryBuilder('item')
      .where('item.rentalId = :rentalId', { rentalId })
      .orderBy('item.gameCopyId', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  async lockRenterForIssue(manager: EntityManager, renterId: string): Promise<void> {
    // The locked rental's FK guarantees the renter exists and prevents deletion.
    await manager.findOne(Renter, {
      select: { renterId: true },
      where: { renterId },
      lock: { mode: 'for_no_key_update' },
    });
  }

  async issue(
    manager: EntityManager,
    rentalId: string,
    rentedAt: Date,
    dueAt: Date,
  ): Promise<void> {
    await manager.update(Rental, rentalId, { status: 'ACTIVE', rentedAt, dueAt });
  }

  async cancel(
    manager: EntityManager,
    rentalId: string,
    at: Date,
    actorId: string | null,
    reason: string,
  ): Promise<void> {
    // The cancellation trigger releases all reserved items in the same transaction.
    await manager.update(Rental, rentalId, {
      status: 'CANCELLED',
      cancelledAt: at,
      cancelledBy: actorId,
      cancellationReason: reason,
    });
  }

  async returnItems(manager: EntityManager, rentalId: string, at: Date): Promise<void> {
    // Preserve dates of any historical partial returns; release only outstanding items.
    await manager.update(RentalItem, { rentalId, returnedAt: IsNull() }, { returnedAt: at });
    await manager.update(Rental, rentalId, { status: 'RETURNED' });
  }

  async markOverdue(manager: EntityManager, rentalId: string): Promise<void> {
    await manager.update(Rental, rentalId, { status: 'OVERDUE' });
  }

  findDeadlineCandidates(
    status: 'BOOKED' | 'ACTIVE',
    cutoff: Date,
    limit: number,
    after?: RentalDeadlineCandidate,
  ): Promise<RentalDeadlineCandidate[]> {
    const deadlineColumn = status === 'BOOKED' ? 'booking_expires_at' : 'due_at';
    return this.dataSource.query<RentalDeadlineCandidate[]>(
      `SELECT rental_id AS "rentalId", ${deadlineColumn}::text AS "deadlineAt"
       FROM rentals
       WHERE status = $1 AND ${deadlineColumn} <= $2
         AND ($3::timestamptz IS NULL OR (${deadlineColumn}, rental_id) > ($3::timestamptz, $4::uuid))
       ORDER BY ${deadlineColumn}, rental_id LIMIT $5`,
      [status, cutoff, after?.deadlineAt ?? null, after?.rentalId ?? null, limit],
    );
  }

  async reserveRequest(manager: EntityManager, key: string, hash: string) {
    // A conflicting insert waits for the owner to commit/rollback. The next
    // statement gets a fresh READ COMMITTED snapshot and locks the resulting row.
    const inserted = await manager.query<{ idempotency_key: string }[]>(
      `INSERT INTO rental_requests (idempotency_key, request_hash) VALUES ($1, $2)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key`,
      [key, hash],
    );
    const record = await manager.findOneOrFail(RentalRequest, {
      where: { idempotencyKey: key },
      lock: { mode: 'pessimistic_write' },
    });
    return { record, created: inserted.length > 0 };
  }

  async saveRequestResponse(
    manager: EntityManager,
    key: string,
    response: BookingReceipt,
  ): Promise<void> {
    await manager.update(RentalRequest, { idempotencyKey: key }, { response });
  }

  findPage(page: PageQuery, renterId?: string): Promise<Rental[]> {
    const query = this.dataSource
      .getRepository(Rental)
      .createQueryBuilder('rental')
      .orderBy('rental.rentalId', 'ASC')
      .take(page.limit + 1);
    if (renterId) query.where('rental.renterId = :renterId', { renterId });
    if (page.after) query.andWhere('rental.rentalId > :after', { after: page.after });
    return query.getMany();
  }

  findWithItems(rentalId: string): Promise<Rental | null> {
    return this.dataSource.getRepository(Rental).findOne({
      where: { rentalId },
      relations: { items: true },
      order: { items: { gameCopyId: 'ASC' } },
    });
  }
}
