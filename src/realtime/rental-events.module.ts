import { Module } from '@nestjs/common';
import { RentalEventsService } from './rental-events.service';

/** Shared API-local bus; importing it starts no background processing. */
@Module({ providers: [RentalEventsService], exports: [RentalEventsService] })
export class RentalEventsModule {}
