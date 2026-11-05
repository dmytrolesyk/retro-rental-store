import { Module } from '@nestjs/common';
import { RentalEventsModule } from './rental-events.module';
import { RentalEventHistoryRepository } from './rental-event-history.repository';
import { RentalReplayService } from './rental-replay.service';

/** Read history and follow bus hints without starting the outbox relay. */
@Module({
  imports: [RentalEventsModule],
  providers: [RentalEventHistoryRepository, RentalReplayService],
  exports: [RentalReplayService],
})
export class RentalReplayModule {}
