interface IssueBooking {
  readonly bookingExpiresAt: Date | null;
}

interface BookedItem {
  readonly costPerDay: number;
}

export interface IssueTerms {
  amount: number;
  rentedAt: Date;
  dueAt: Date;
}

export class InvalidRentalIssueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRentalIssueError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pure business rules. The caller supplies time after acquiring blocking locks. */
export function prepareIssueTerms(
  rental: IssueBooking,
  items: readonly BookedItem[],
  now: Date,
): IssueTerms {
  if (!items.length) throw new InvalidRentalIssueError('Rental has no items');
  if (!rental.bookingExpiresAt || rental.bookingExpiresAt <= now)
    throw new InvalidRentalIssueError('Booking has expired');
  const amount = items.reduce((total, item) => total + item.costPerDay, 0);
  if (!Number.isSafeInteger(amount)) throw new InvalidRentalIssueError('Invalid rental amount');
  return {
    amount,
    rentedAt: new Date(now.getTime()),
    dueAt: new Date(now.getTime() + DAY_MS),
  };
}
