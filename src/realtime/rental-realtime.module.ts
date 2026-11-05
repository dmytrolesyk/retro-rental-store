import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RentalOutboxModule } from '../outbox/rental-outbox.module';
import { RentalsModule } from '../rentals/rentals.module';
import { RentalEventsGateway } from './rental-events.gateway';

/** API only: owns transport delivery, never business writes or outbox processing. */
@Module({
  imports: [AuthModule, RentalsModule, RentalOutboxModule],
  providers: [RentalEventsGateway],
})
export class RentalRealtimeModule {}
