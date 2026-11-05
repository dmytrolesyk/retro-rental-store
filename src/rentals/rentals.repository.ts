import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { PageQuery } from '../common/pagination';
import { Rental } from './entities/rental.entity';
import { RentalRequest } from './entities/rental-request.entity';
import type { RentalReceipt } from './rentals.types';
import { Renter } from '../renters/entities/renter.entity';
import { RentalItem } from './entities/rental-item.entity';
import { RentalJob } from '../jobs/entities/rental-job.entity';

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

@Injectable()
export class RentalsRepository {
  constructor(private readonly dataSource: DataSource) {}

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
             WHERE i.game_copy_id = c.game_copy_id AND i.returned_at IS NULL
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
      await manager.existsBy(RentalItem, { gameCopyId: copy.gameCopyId, returnedAt: IsNull() })
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
    response: RentalReceipt,
  ): Promise<void> {
    await manager.update(RentalRequest, { idempotencyKey: key }, { response });
  }

  findPage(page: PageQuery): Promise<Rental[]> {
    const query = this.dataSource
      .getRepository(Rental)
      .createQueryBuilder('rental')
      .orderBy('rental.rentalId', 'ASC')
      .take(page.limit + 1);
    if (page.after) query.where('rental.rentalId > :after', { after: page.after });
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
