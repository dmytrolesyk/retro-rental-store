/** Persisted checkout receipt, independent of HTTP decorators and TypeORM entities. */
export interface RentalReceipt {
  rentalId: string;
  gameCopyId: string;
  chargedAmount: number;
  balance: number;
}

export interface CreateRentalResult {
  response: RentalReceipt;
  replayed: boolean;
}
