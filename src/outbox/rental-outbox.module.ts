import { Module } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';
import { QueueRentalStatusEmail } from './queue-rental-status-email';
import { ProcessRentalOutbox } from './process-rental-outbox';
import { RentalOutboxDispatcher } from './rental-outbox.dispatcher';
import { OutboxCommitSubscriber } from './outbox-commit.subscriber';
import { RentalEventsService } from '../realtime/rental-events.service';

/** API only: email worker and offline demos do not run an outbox relay. */
@Module({
  providers: [
    OutboxRepository,
    QueueRentalStatusEmail,
    ProcessRentalOutbox,
    RentalOutboxDispatcher,
    OutboxCommitSubscriber,
    RentalEventsService,
  ],
  exports: [RentalEventsService],
})
export class RentalOutboxModule {}
