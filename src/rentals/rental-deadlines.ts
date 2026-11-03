import { nextRentalStatus } from './rental-lifecycle';
import type { RentalStatus } from './rental-lifecycle';

export const BOOKING_EXPIRY_REASON = 'Booking was not collected before its deadline';

interface RentalDeadlines {
  readonly status: RentalStatus;
  readonly bookingExpiresAt: Date | null;
  readonly dueAt: Date | null;
}

/** Pure decision; stale candidates and already completed transitions are no-ops. */
export function nextDeadlineStatus(rental: RentalDeadlines, now: Date): RentalStatus | null {
  if (rental.status === 'BOOKED' && rental.bookingExpiresAt && rental.bookingExpiresAt <= now)
    return nextRentalStatus(rental.status, 'cancel');
  if (rental.status === 'ACTIVE' && rental.dueAt && rental.dueAt <= now)
    return nextRentalStatus(rental.status, 'markOverdue');
  return null;
}
