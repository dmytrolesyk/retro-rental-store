import { Module } from '@nestjs/common';
import { RentalsService } from './rentals.service';
import { RentalsController } from './rentals.controller';
import { CreateRentalResponseInterceptor } from './create-rental-response.interceptor';
import { RentalsRepository } from './rentals.repository';

@Module({
  controllers: [RentalsController],
  providers: [RentalsService, RentalsRepository, CreateRentalResponseInterceptor],
  exports: [RentalsService],
})
export class RentalsModule {}
