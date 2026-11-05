import { Module } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';
import { QueueRentalStatusEmail } from './queue-rental-status-email';
import { ProcessRentalOutbox } from './process-rental-outbox';
import { RentalOutboxDispatcher } from './rental-outbox.dispatcher';
import { OutboxCommitSubscriber } from './outbox-commit.subscriber';
import { RentalEventsModule } from '../realtime/rental-events.module';

/** API only: email worker and offline demos do not run an outbox relay. */
@Module({
  imports: [RentalEventsModule],
  providers: [
    OutboxRepository,
    QueueRentalStatusEmail,
    ProcessRentalOutbox,
    RentalOutboxDispatcher,
    OutboxCommitSubscriber,
  ],
})
export class RentalOutboxModule {}
