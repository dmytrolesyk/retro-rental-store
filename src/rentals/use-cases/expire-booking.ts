import { RentalStatusEventWriter } from '../rental-status-event.writer';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BOOKING_EXPIRY_REASON, nextDeadlineStatus } from '../rental-deadlines';
import { RentalsRepository } from '../rentals.repository';

/** Trusted system use case, not an HTTP action and not a staff impersonation. */
@Injectable()
export class ExpireBooking {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rentalsRepository: RentalsRepository,
    private readonly rentalStatusEventWriter: RentalStatusEventWriter,
  ) {}

  execute(rentalId: string): Promise<boolean> {
    return this.dataSource.transaction('READ COMMITTED', async manager => {
      const rental = await this.rentalsRepository.findForUpdate(manager, rentalId);
      if (!rental) return false;
      await this.rentalsRepository.findItemsForUpdate(manager, rentalId);
      const now = await this.rentalsRepository.currentTime(manager);
      if (nextDeadlineStatus(rental, now) !== 'CANCELLED') return false;
      await this.rentalsRepository.cancel(manager, rentalId, now, null, BOOKING_EXPIRY_REASON);
      await this.rentalStatusEventWriter.recordStatusChange(manager, rentalId, rental.status, now);
      return true;
    });
  }
}
