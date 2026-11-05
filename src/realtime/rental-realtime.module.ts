import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RentalEventsModule } from './rental-events.module';
import { RentalReplayModule } from './rental-replay.module';
import { RentalsModule } from '../rentals/rentals.module';
import { RentalEventsGateway } from './rental-events.gateway';
import { RentalEventsController } from './rental-events.controller';

/** API only: owns transport delivery, never business writes or outbox processing. */
@Module({
  imports: [AuthModule, RentalsModule, RentalEventsModule, RentalReplayModule],
  controllers: [RentalEventsController],
  providers: [RentalEventsGateway],
})
export class RentalRealtimeModule {}
