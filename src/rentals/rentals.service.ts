import { createHash } from 'node:crypto';
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { checkout, checkoutInTransaction } from './checkout';
import type { CheckoutRequest, CheckoutResult } from './checkout';
import type { Rental } from './entities/rental.entity';
import type { RentalDetailDto, RentalPageDto } from './rentals.dto';
import { RentalsRepository } from './rentals.repository';
import type { CreateRentalResult } from './rentals.types';
import { pageOf } from '../common/pagination';
import type { PageQuery } from '../common/pagination';

function summary(rental: Rental) {
  return {
    rentalId: rental.rentalId,
    renterId: rental.renterId,
    rentedAt: rental.rentedAt.toISOString(),
  };
}

@Injectable()
export class RentalsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rentals: RentalsRepository,
  ) {}

  checkout(request: CheckoutRequest): Promise<CheckoutResult> {
    return checkout(this.dataSource, request, this.rentals);
  }

  async create(request: CheckoutRequest, key: string): Promise<CreateRentalResult> {
    // Stable field order: JSON object property order is not part of request identity.
    const canonical = {
      renterId: request.renterId.toLowerCase(),
      gameId: request.gameId.toLowerCase(),
      platformId: request.platformId.toLowerCase(),
    };
    const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    return this.dataSource.transaction('READ COMMITTED', async manager => {
      const { record, created } = await this.rentals.reserveRequest(manager, key, hash);
      if (record.requestHash !== hash)
        throw new UnprocessableEntityException(
          'Idempotency-Key was already used with a different request',
        );
      if (record.response) return { response: record.response, replayed: true };
      if (!created) throw new InternalServerErrorException('Incomplete idempotency record');

      const result = await checkoutInTransaction(manager, canonical, this.rentals);
      const response = {
        rentalId: result.rentalId,
        gameCopyId: result.gameCopyId,
        chargedAmount: result.chargedAmount,
        balance: result.balance,
      };
      await this.rentals.saveRequestResponse(manager, key, response);
      return { response, replayed: false };
    });
  }

  async list(page: PageQuery): Promise<RentalPageDto> {
    const rentals = await this.rentals.findPage(page);
    return pageOf(rentals.map(summary), page, 'rentals', rental => rental.rentalId);
  }

  async get(rentalId: string): Promise<RentalDetailDto> {
    const rental = await this.rentals.findWithItems(rentalId);
    if (!rental) throw new NotFoundException('Rental not found');
    return {
      ...summary(rental),
      items: rental.items.map(item => ({
        gameCopyId: item.gameCopyId,
        costPerDay: item.costPerDay,
        returnedAt: item.returnedAt?.toISOString() ?? null,
      })),
    };
  }
}
