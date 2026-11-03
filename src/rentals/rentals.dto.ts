import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { RENTAL_STATUSES } from './rental-lifecycle';
import type { RentalStatus } from './rental-lifecycle';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import {
  IDEMPOTENCY_KEY_PATTERN,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MIN_IDEMPOTENCY_KEY_LENGTH,
} from './rentals.constants';
import type { BookingReceipt } from './rentals.types';

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

export class CreatedRentalDto implements BookingReceipt {
  @ApiProperty({ format: 'uuid' }) rentalId: string;
  @ApiProperty({ format: 'uuid' }) gameCopyId: string;
  @ApiProperty({ enum: ['BOOKED'] }) status: 'BOOKED';
  @ApiProperty({ format: 'date-time' }) bookedAt: string;
  @ApiProperty({ format: 'date-time' }) bookingExpiresAt: string;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Price fixed at booking, charged for one day at issue, in kopecks.',
  })
  costPerDay: number;
}

export class CancelRentalDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 500,
    description: 'Nonblank reason for cancellation before issue.',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 500)
  reason: string;
}

export class RentalSummaryDto {
  @ApiProperty({ enum: RENTAL_STATUSES }) status: RentalStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) bookedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) bookingExpiresAt:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt: string | null;
  @ApiProperty({ format: 'uuid' }) rentalId: string;
  @ApiProperty({ format: 'uuid' }) renterId: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) rentedAt: string | null;
}

export class RentalItemDto {
  @ApiProperty({ format: 'uuid' }) gameCopyId: string;
  @ApiProperty({ type: 'integer', minimum: 0, description: 'Historical price per day in kopecks.' })
  costPerDay: number;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) releasedAt: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) returnedAt: string | null;
}

export class RentalDetailDto extends RentalSummaryDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelledBy: string | null;
  @ApiProperty({ type: String, nullable: true }) cancellationReason: string | null;
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
