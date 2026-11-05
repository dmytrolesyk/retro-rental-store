import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Rental } from '../rentals/entities/rental.entity';
import { RentalOutboxEvent } from '../outbox/entities/rental-outbox-event.entity';
import { publicRentalStatusEvent } from '../rentals/rental-status-event';
import type { RentalStatusChanged } from '../rentals/rental-status-event';

export const RENTAL_HISTORY_PAGE_SIZE = 100;

export interface RentalHistoryEntry {
  readonly position: string;
  readonly event: RentalStatusChanged;
}

/** Durable history, independent of consumer delivery/acknowledgement state. */
@Injectable()
export class RentalEventHistoryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findOwner(rentalId: string): Promise<string | null> {
    const rental = await this.dataSource.getRepository(Rental).findOne({
      select: { renterId: true },
      where: { rentalId },
    });
    return rental?.renterId ?? null;
  }

  async findCursor(rentalId: string, eventId: string): Promise<string | null> {
    const event = await this.dataSource.getRepository(RentalOutboxEvent).findOne({
      select: { position: true },
      where: { rentalId, eventId },
    });
    return event?.position ?? null;
  }

  async readAfter(rentalId: string, position: string | null): Promise<RentalHistoryEntry[]> {
    const query = this.dataSource
      .getRepository(RentalOutboxEvent)
      .createQueryBuilder('event')
      .select(['event.position', 'event.payload'])
      .where('event.rentalId = :rentalId', { rentalId })
      .orderBy('event.position', 'ASC')
      .limit(RENTAL_HISTORY_PAGE_SIZE);
    if (position !== null) query.andWhere('event.position > :position', { position });
    // Safe only within one rental: all producers must hold its parent lock until commit.
    // Never use a cross-rental MAX(position) as a commit watermark.
    return (await query.getMany()).map(row => ({
      position: row.position,
      event: publicRentalStatusEvent(row.payload),
    }));
  }
}
