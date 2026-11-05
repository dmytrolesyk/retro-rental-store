import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Rental } from './entities/rental.entity';
import { Renter } from '../renters/entities/renter.entity';
import { rentalNotification } from '../jobs/rental-notification';
import { RentalOutboxEvent } from '../outbox/entities/rental-outbox-event.entity';
import { RentalOutboxDelivery } from '../outbox/entities/rental-outbox-delivery.entity';
import { rentalStatusChanged } from './rental-status-event';
import type { RentalStatus } from './rental-lifecycle';

/** Freeze the event and delivery snapshots using the caller's transaction. */
@Injectable()
export class RentalStatusEventWriter {
  async recordStatusChange(
    manager: EntityManager,
    rentalId: string,
    previousStatus: RentalStatus | null,
    occurredAt: Date,
  ): Promise<void> {
    const rental = await manager.findOneByOrFail(Rental, { rentalId });
    const renter = await manager.findOneByOrFail(Renter, { renterId: rental.renterId });
    const eventId = randomUUID();
    await manager.insert(RentalOutboxEvent, {
      eventId,
      rentalId,
      status: rental.status,
      payload: rentalStatusChanged(eventId, rental, previousStatus, occurredAt),
      emailTo: renter.email,
      emailNotification: rentalNotification(rental, occurredAt),
    });
    await manager.insert(RentalOutboxDelivery, [
      { eventId, consumer: 'email' },
      { eventId, consumer: 'realtime' },
    ]);
  }
}
