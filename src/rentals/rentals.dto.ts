import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import {
  IDEMPOTENCY_KEY_PATTERN,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MIN_IDEMPOTENCY_KEY_LENGTH,
} from './rentals.constants';
import type { RentalReceipt } from './rentals.types';

export class CreateRentalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  renterId: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  gameId: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  platformId: string;
}

export class RentalRequestHeadersDto {
  @IsString()
  @Length(MIN_IDEMPOTENCY_KEY_LENGTH, MAX_IDEMPOTENCY_KEY_LENGTH)
  @Matches(IDEMPOTENCY_KEY_PATTERN)
  idempotencyKey: string;
}

export class CreatedRentalDto implements RentalReceipt {
  @ApiProperty({ format: 'uuid' }) rentalId: string;
  @ApiProperty({ format: 'uuid' }) gameCopyId: string;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Amount charged for one day, in integer kopecks.',
  })
  chargedAmount: number;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description:
      'Balance immediately after checkout, in kopecks. A replay returns the original value.',
  })
  balance: number;
}

export class RentalSummaryDto {
  @ApiProperty({ format: 'uuid' }) rentalId: string;
  @ApiProperty({ format: 'uuid' }) renterId: string;
  @ApiProperty({ format: 'date-time' }) rentedAt: string;
}

export class RentalItemDto {
  @ApiProperty({ format: 'uuid' }) gameCopyId: string;
  @ApiProperty({ type: 'integer', minimum: 0, description: 'Historical price per day in kopecks.' })
  costPerDay: number;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) returnedAt: string | null;
}

export class RentalDetailDto extends RentalSummaryDto {
  @ApiProperty({ type: [RentalItemDto] }) items: RentalItemDto[];
}

export class RentalPageDto {
  @ApiProperty({ type: [RentalSummaryDto] }) items: RentalSummaryDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque token for the next page; null when there are no more items.',
  })
  next_cursor: string | null;
}
