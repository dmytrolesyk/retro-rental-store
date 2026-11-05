import type { Rental } from './entities/rental.entity';
import type { RentalItem } from './entities/rental-item.entity';
import type { RentalDetailDto } from './rentals.dto';

export function rentalSummary(rental: Rental) {
  return {
    rentalId: rental.rentalId,
    renterId: rental.renterId,
    status: rental.status,
    bookedAt: rental.bookedAt?.toISOString() ?? null,
    bookingExpiresAt: rental.bookingExpiresAt?.toISOString() ?? null,
    rentedAt: rental.rentedAt?.toISOString() ?? null,
    dueAt: rental.dueAt?.toISOString() ?? null,
  };
}
export function rentalDetail(rental: Rental, items: RentalItem[]): RentalDetailDto {
  return {
    ...rentalSummary(rental),
    cancelledAt: rental.cancelledAt?.toISOString() ?? null,
    cancelledBy: rental.cancelledBy,
    cancellationReason: rental.cancellationReason,
    items: items.map(item => ({
      gameCopyId: item.gameCopyId,
      costPerDay: item.costPerDay,
      returnedAt: item.returnedAt?.toISOString() ?? null,
      releasedAt: item.releasedAt?.toISOString() ?? null,
    })),
  };
}
