import { RentalStatusEventWriter } from '../rental-status-event.writer';
import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { assertRentalAccess } from '../../auth/rental-access';
import type { Principal } from '../../auth/principal';
import type { RentalDetailDto } from '../rentals.dto';
import { nextRentalStatus } from '../rental-lifecycle';
import { rentalDetail } from '../rentals.mapper';
import { RentalsRepository } from '../rentals.repository';
import { CheckoutError } from '../checkout';
import { prepareIssueTerms } from '../rental-issue';

@Injectable()
export class IssueRental {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rentalsRepository: RentalsRepository,
    private readonly rentalStatusEventWriter: RentalStatusEventWriter,
  ) {}

  execute(rentalId: string, principal: Principal): Promise<RentalDetailDto> {
    return this.dataSource.transaction('READ COMMITTED', async manager => {
      const rental = await this.rentalsRepository.findForUpdate(manager, rentalId);
      if (!rental) throw new NotFoundException('Rental not found');
      assertRentalAccess(principal, rental.renterId, 'issue');
      const nextStatus = nextRentalStatus(rental.status, 'issue');
      const rentalItems = await this.rentalsRepository.findItemsForUpdate(manager, rentalId);
      if (nextStatus === null) return rentalDetail(rental, rentalItems);
      // All blocking locks precede the time check: a booking can expire while waiting.
      await this.rentalsRepository.lockRenterForIssue(manager, rental.renterId);
      const now = await this.rentalsRepository.currentTime(manager);
      const terms = prepareIssueTerms(rental, rentalItems, now);
      const remainingBalance = await this.rentalsRepository.debitBalance(
        manager,
        rental.renterId,
        terms.amount,
      );
      if (remainingBalance === null)
        throw new CheckoutError('INSUFFICIENT_BALANCE', 'Renter has insufficient balance');
      await this.rentalsRepository.issue(manager, rentalId, terms.rentedAt, terms.dueAt);
      await this.rentalStatusEventWriter.recordStatusChange(manager, rentalId, rental.status, now);
      const updatedRental = await this.rentalsRepository.findForUpdate(manager, rentalId);
      if (!updatedRental) throw new InternalServerErrorException('Rental disappeared while locked');
      return rentalDetail(
        updatedRental,
        await this.rentalsRepository.findItemsForUpdate(manager, rentalId),
      );
    });
  }
}
