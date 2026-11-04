import { Injectable } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';
import { QueueRentalStatusEmail } from './queue-rental-status-email';
import { RentalEventsService } from '../realtime/rental-events.service';

/** Max delivery attempts per pass; one event normally has two consumers. */
export const OUTBOX_BATCH_SIZE = 100;

@Injectable()
export class ProcessRentalOutbox {
  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly queueRentalStatusEmailUseCase: QueueRentalStatusEmail,
    private readonly rentalEventsService: RentalEventsService,
  ) {}

  async execute(): Promise<{ emailQueued: number; realtimePublished: number; failed: number }> {
    const counts = { emailQueued: 0, realtimePublished: 0, failed: 0 };
    let claimed = 0;
    while (claimed < OUTBOX_BATCH_SIZE) {
      let progressed = false;
      for (const consumer of ['email', 'realtime'] as const) {
        if (claimed >= OUTBOX_BATCH_SIZE) break;
        const result = await this.outboxRepository.processNext(consumer, async (manager, event) => {
          if (consumer === 'email') {
            await this.queueRentalStatusEmailUseCase.execute(manager, event);
          } else {
            this.rentalEventsService.publish(event.payload);
          }
        });
        if (result === null) continue;
        progressed = true;
        claimed++;
        if (result === 'failed') counts.failed++;
        else if (consumer === 'email') counts.emailQueued++;
        else counts.realtimePublished++;
      }
      if (!progressed) break;
    }
    return counts;
  }
}
