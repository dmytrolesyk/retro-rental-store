import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { RentalOutboxEvent } from './entities/rental-outbox-event.entity';

@Injectable()
export class QueueRentalStatusEmail {
  async execute(manager: EntityManager, event: RentalOutboxEvent): Promise<void> {
    // Target this conflict only. Other integrity failures must cause retry, not a false ack.
    await manager.query(
      `INSERT INTO rental_jobs
      (rental_id, email_to, notification_status, notification, outbox_event_id)
      VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (outbox_event_id) WHERE outbox_event_id IS NOT NULL DO NOTHING`,
      [
        event.rentalId,
        event.emailTo,
        event.status,
        JSON.stringify(event.emailNotification),
        event.eventId,
      ],
    );
  }
}
