import { Module } from '@nestjs/common';
import { RentalsModule } from './rentals.module';
import { RentalDeadlinesScheduler } from './rental-deadlines.scheduler';

/** Imported by the API only; legacy CLI contexts do not start background processing. */
@Module({ imports: [RentalsModule], providers: [RentalDeadlinesScheduler] })
export class RentalDeadlinesModule {}
