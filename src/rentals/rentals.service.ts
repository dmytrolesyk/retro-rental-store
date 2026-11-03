import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { assertRentalAccess } from '../auth/rental-access';
import type { Principal } from '../auth/principal';
import { checkout, CheckoutError } from './checkout';
import type { CheckoutRequest, CheckoutResult } from './checkout';
import type { RentalDetailDto, RentalPageDto } from './rentals.dto';
import { RentalsRepository } from './rentals.repository';
import { rentalSummary, rentalDetail } from './rentals.mapper';
import type { CreateRentalResult } from './rentals.types';
import { pageOf } from '../common/pagination';
import type { PageQuery } from '../common/pagination';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RentalsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rentalsRepository: RentalsRepository,
  ) {}

  /** Trusted legacy coursework entry point; HTTP creation now books instead. */
  checkout(request: CheckoutRequest): Promise<CheckoutResult> {
    return checkout(this.dataSource, request, this.rentalsRepository);
  }

  async create(
    request: CheckoutRequest,
    idempotencyKey: string,
    principal: Principal,
  ): Promise<CreateRentalResult> {
    assertRentalAccess(principal, request.renterId, 'create');
    const canonicalRequest = {
      renterId: request.renterId.toLowerCase(),
      gameId: request.gameId.toLowerCase(),
      platformId: request.platformId.toLowerCase(),
    };
    const requestHash = createHash('sha256').update(JSON.stringify(canonicalRequest)).digest('hex');
    return this.dataSource.transaction('READ COMMITTED', async manager => {
      const { record: requestRecord, created: requestCreated } =
        await this.rentalsRepository.reserveRequest(manager, idempotencyKey, requestHash);
      // Retain old receipts, but never pretend an already-paid checkout is a booking.
      if (requestRecord.response && !('status' in requestRecord.response))
        throw new ConflictException('Idempotency-Key belongs to a legacy checkout; use a new key');
      if (requestRecord.requestHash !== requestHash)
        throw new UnprocessableEntityException(
          'Idempotency-Key was already used with a different request',
        );
      if (requestRecord.response) return { response: requestRecord.response, replayed: true };
      if (!requestCreated) throw new InternalServerErrorException('Incomplete idempotency record');
      const renter = await this.rentalsRepository.findRenterForCheckout(
        manager,
        canonicalRequest.renterId,
      );
      if (!renter) throw new CheckoutError('RENTER_NOT_FOUND', 'Renter does not exist');
      const availableCopy = await this.rentalsRepository.findAvailableCopyForUpdate(
        manager,
        canonicalRequest.gameId,
        canonicalRequest.platformId,
      );
      if (!availableCopy)
        throw new CheckoutError('COPY_UNAVAILABLE', 'No available copy for this game and platform');
      const bookedAt = await this.rentalsRepository.currentTime(manager);
      const bookingExpiresAt = new Date(bookedAt.getTime() + DAY_MS);
      const rentalId = await this.rentalsRepository.saveBooking(manager, {
        renterId: canonicalRequest.renterId,
        gameCopyId: availableCopy.gameCopyId,
        costPerDay: availableCopy.pricePerDay,
        bookedAt,
        bookingExpiresAt,
      });
      await this.rentalsRepository.queueStatusEmail(manager, rentalId, bookedAt);
      const bookingReceipt = {
        rentalId,
        gameCopyId: availableCopy.gameCopyId,
        status: 'BOOKED' as const,
        bookedAt: bookedAt.toISOString(),
        bookingExpiresAt: bookingExpiresAt.toISOString(),
        costPerDay: availableCopy.pricePerDay,
      };
      await this.rentalsRepository.saveRequestResponse(manager, idempotencyKey, bookingReceipt);
      return { response: bookingReceipt, replayed: false };
    });
  }

  async list(page: PageQuery, principal: Principal): Promise<RentalPageDto> {
    const rentals = await this.rentalsRepository.findPage(
      page,
      principal.role === 'client' ? principal.renterId : undefined,
    );
    return pageOf(rentals.map(rentalSummary), page, 'rentals', rental => rental.rentalId);
  }
  async get(rentalId: string, principal: Principal): Promise<RentalDetailDto> {
    const rental = await this.rentalsRepository.findWithItems(rentalId);
    if (!rental) throw new NotFoundException('Rental not found');
    assertRentalAccess(principal, rental.renterId, 'read');
    return rentalDetail(rental, rental.items);
  }
}
