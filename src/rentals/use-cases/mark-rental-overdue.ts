import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { nextDeadlineStatus } from '../rental-deadlines';
import { RentalsRepository } from '../rentals.repository';

/** Trusted system use case; a concurrent physical return takes precedence once committed. */
@Injectable()
export class MarkRentalOverdue {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rentalsRepository: RentalsRepository,
  ) {}

  execute(rentalId: string): Promise<boolean> {
    return this.dataSource.transaction('READ COMMITTED', async manager => {
      const rental = await this.rentalsRepository.findForUpdate(manager, rentalId);
      if (!rental) return false;
      const now = await this.rentalsRepository.currentTime(manager);
      if (nextDeadlineStatus(rental, now) !== 'OVERDUE') return false;
      await this.rentalsRepository.markOverdue(manager, rentalId);
      return true;
    });
  }
}
