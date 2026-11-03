/** Historical HTTP checkout receipt. Retained to recognize old persisted keys safely. */
export interface LegacyCheckoutReceipt {
  rentalId: string;
  gameCopyId: string;
  chargedAmount: number;
  balance: number;
}

/** Immutable booking receipt; a later issue does not alter an idempotent replay. */
export interface BookingReceipt {
  rentalId: string;
  gameCopyId: string;
  status: 'BOOKED';
  bookedAt: string;
  bookingExpiresAt: string;
  costPerDay: number;
}

export interface CreateRentalResult {
  response: BookingReceipt;
  replayed: boolean;
}
