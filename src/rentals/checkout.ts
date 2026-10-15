import { IsNull } from 'typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';
import { Rental, RentalItem, RentalJob, Renter } from '../database/entities';

export interface CheckoutRequest {
  renterId: string;
  gameId: string;
  platformId: string;
}

// Monetary values are integer minor units: 2500 means 25 UAH.
export interface CheckoutResult {
  rentalId: string;
  gameCopyId: string;
  jobId: string;
  chargedAmount: number;
  balance: number;
}

export class CheckoutError extends Error {
  constructor(
    public readonly code:
      'INVALID_INPUT' | 'COPY_UNAVAILABLE' | 'RENTER_NOT_FOUND' | 'INSUFFICIENT_BALANCE',
    message: string,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

const requestSchema = z.object({ renterId: z.uuid(), gameId: z.uuid(), platformId: z.uuid() });

interface AvailableCopy {
  gameCopyId: string;
  pricePerDay: number;
}

// One call rents one physical copy for one day. The caller supplies an initialized DataSource.
export async function checkout(
  dataSource: DataSource,
  request: CheckoutRequest,
): Promise<CheckoutResult> {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) {
    throw new CheckoutError('INVALID_INPUT', 'Renter, game and platform IDs must be UUIDs');
  }
  const { renterId, gameId, platformId } = parsed.data;

  return dataSource.transaction('READ COMMITTED', async manager => {
    await ensureRenterExists(manager, renterId);
    const copy = await findAvailableCopyForUpdate(manager, gameId, platformId);
    const balance = await debitRenterBalance(manager, renterId, copy.pricePerDay);

    const rental = await manager.save(Rental, { renterId, rentedAt: new Date() });
    await manager.insert(RentalItem, {
      rentalId: rental.rentalId,
      gameCopyId: copy.gameCopyId,
      costPerDay: copy.pricePerDay,
    });
    const job = await manager.save(RentalJob, { rentalId: rental.rentalId });

    return {
      rentalId: rental.rentalId,
      gameCopyId: copy.gameCopyId,
      jobId: job.jobId,
      chargedAmount: copy.pricePerDay,
      balance,
    };
  });
}

async function ensureRenterExists(manager: EntityManager, renterId: string): Promise<void> {
  // Keep the renter from being deleted after validation. KEY SHARE still allows
  // non-key updates, including concurrent atomic balance deductions.
  const renter = await manager.findOne(Renter, {
    select: { renterId: true },
    where: { renterId },
    lock: { mode: 'for_key_share' },
  });
  if (!renter) {
    throw new CheckoutError('RENTER_NOT_FOUND', 'Renter does not exist');
  }
}

async function findAvailableCopyForUpdate(
  manager: EntityManager,
  gameId: string,
  platformId: string,
): Promise<AvailableCopy> {
  let previousCopyId: string | null = null;
  let copy: AvailableCopy | undefined;
  do {
    // Advance through UUID order; a larger UUID does not mean a newer copy.
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
    if (!copy) {
      throw new CheckoutError('COPY_UNAVAILABLE', 'No available copy for this game and platform');
    }
    previousCopyId = copy.gameCopyId;
    // The first SELECT snapshot predates any lock wait. Recheck rental_items in
    // a fresh READ COMMITTED statement, then move on if the copy was taken.
  } while (await isCopyRented(manager, copy.gameCopyId));

  return copy;
}

function isCopyRented(manager: EntityManager, gameCopyId: string): Promise<boolean> {
  return manager.existsBy(RentalItem, { gameCopyId, returnedAt: IsNull() });
}

async function debitRenterBalance(
  manager: EntityManager,
  renterId: string,
  amount: number,
): Promise<number> {
  // TypeORM 0.3's raw UPDATE result is [returnedRows, affectedCount].
  const [balances] = await manager.query<[{ balance: number }[], number]>(
    `UPDATE renters SET balance = balance - $1
     WHERE renter_id = $2 AND balance >= $1
     RETURNING balance`,
    [amount, renterId],
  );
  const balanceRow = balances.at(0);
  // ensureRenterExists holds KEY SHARE until this transaction ends, so a
  // missing RETURNING row now unambiguously means insufficient balance.
  if (!balanceRow) {
    throw new CheckoutError('INSUFFICIENT_BALANCE', 'Renter has insufficient balance');
  }
  return balanceRow.balance;
}
