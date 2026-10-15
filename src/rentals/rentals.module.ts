import { Module } from '@nestjs/common';
import { RentalsService } from './rentals.service';

@Module({
  providers: [RentalsService],
  exports: [RentalsService],
})
export class RentalsModule {}
