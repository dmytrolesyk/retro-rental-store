import { RentalStatusEventWriter } from '../rental-status-event.writer';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { assertRentalAccess } from '../../auth/rental-access';
import type { Principal } from '../../auth/principal';
import type { RentalDetailDto } from '../rentals.dto';
import { nextRentalStatus } from '../rental-lifecycle';
import { rentalDetail } from '../rentals.mapper';
import { RentalsRepository } from '../rentals.repository';

@Injectable()
export class CancelRental {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rentalsRepository: RentalsRepository,
    private readonly rentalStatusEventWriter: RentalStatusEventWriter,
  ) {}

  execute(rentalId: string, principal: Principal, reason: string): Promise<RentalDetailDto> {
    return this.dataSource.transaction('READ COMMITTED', async manager => {
      const rental = await this.rentalsRepository.findForUpdate(manager, rentalId);
      if (!rental) throw new NotFoundException('Rental not found');
      assertRentalAccess(principal, rental.renterId, 'cancel');
      const nextStatus = nextRentalStatus(rental.status, 'cancel');
      const rentalItems = await this.rentalsRepository.findItemsForUpdate(manager, rentalId);
      if (nextStatus === null) return rentalDetail(rental, rentalItems);
      if (!rentalItems.length) throw new ConflictException('Rental has no items');
      const now = await this.rentalsRepository.currentTime(manager);
      if (!reason.trim() || reason.trim().length > 500)
        throw new ConflictException(
          'Cancellation requires a nonblank reason of up to 500 characters',
        );
      await this.rentalsRepository.cancel(manager, rentalId, now, principal.id, reason.trim());
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
