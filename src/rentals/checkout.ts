import type { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';
import { RentalsRepository } from './rentals.repository';

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

// One call rents one physical copy for one day. The caller supplies an initialized DataSource.
export async function checkout(
  dataSource: DataSource,
  request: CheckoutRequest,
  rentals: RentalsRepository = new RentalsRepository(dataSource),
): Promise<CheckoutResult> {
  return dataSource.transaction('READ COMMITTED', manager =>
    checkoutInTransaction(manager, request, rentals),
  );
}

/** Caller owns the transaction, allowing an HTTP idempotency record to commit atomically. */
export async function checkoutInTransaction(
  manager: EntityManager,
  request: CheckoutRequest,
  rentals: RentalsRepository,
): Promise<CheckoutResult> {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) {
    throw new CheckoutError('INVALID_INPUT', 'Renter, game and platform IDs must be UUIDs');
  }
  const { renterId, gameId, platformId } = parsed.data;

  const renter = await rentals.findRenterForCheckout(manager, renterId);
  if (!renter) throw new CheckoutError('RENTER_NOT_FOUND', 'Renter does not exist');
  const copy = await rentals.findAvailableCopyForUpdate(manager, gameId, platformId);
  if (!copy)
    throw new CheckoutError('COPY_UNAVAILABLE', 'No available copy for this game and platform');
  const balance = await rentals.debitBalance(manager, renterId, copy.pricePerDay);
  // The renter is held by KEY SHARE, so no returned balance means insufficient funds.
  if (balance === null)
    throw new CheckoutError('INSUFFICIENT_BALANCE', 'Renter has insufficient balance');

  const saved = await rentals.saveCheckout(manager, {
    renterId,
    gameCopyId: copy.gameCopyId,
    costPerDay: copy.pricePerDay,
    emailTo: renter.email,
  });

  return {
    ...saved,
    gameCopyId: copy.gameCopyId,
    chargedAmount: copy.pricePerDay,
    balance,
  };
}
