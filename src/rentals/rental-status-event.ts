import type { Rental } from './entities/rental.entity';
import type { RentalStatus } from './rental-lifecycle';

export interface RentalStatusChanged {
  readonly eventId: string;
  readonly type: 'rental.status-changed';
  readonly version: 1;
  readonly rentalId: string;
  readonly previousStatus: RentalStatus | null;
  readonly status: RentalStatus;
  readonly occurredAt: string;
  readonly bookedAt: string | null;
  readonly bookingExpiresAt: string | null;
  readonly rentedAt: string | null;
  readonly dueAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
}

/** Explicit public contract, independent of ORM serialization or email templates. */
export function rentalStatusChanged(
  eventId: string,
  rental: Pick<
    Rental,
    | 'rentalId'
    | 'status'
    | 'bookedAt'
    | 'bookingExpiresAt'
    | 'rentedAt'
    | 'dueAt'
    | 'cancelledAt'
    | 'cancellationReason'
  >,
  previousStatus: RentalStatus | null,
  occurredAt: Date,
): RentalStatusChanged {
  return {
    eventId,
    type: 'rental.status-changed',
    version: 1,
    rentalId: rental.rentalId,
    previousStatus,
    status: rental.status,
    occurredAt: occurredAt.toISOString(),
    bookedAt: rental.bookedAt?.toISOString() ?? null,
    bookingExpiresAt: rental.bookingExpiresAt?.toISOString() ?? null,
    rentedAt: rental.rentedAt?.toISOString() ?? null,
    dueAt: rental.dueAt?.toISOString() ?? null,
    cancelledAt: rental.cancelledAt?.toISOString() ?? null,
    cancellationReason: rental.cancellationReason,
  };
}
