import { ExpireBooking } from './use-cases/expire-booking';
import { MarkRentalOverdue } from './use-cases/mark-rental-overdue';
import { ProcessRentalDeadlines } from './use-cases/process-rental-deadlines';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RentalsService } from './rentals.service';
import { IssueRental } from './use-cases/issue-rental';
import { CancelRental } from './use-cases/cancel-rental';
import { ReturnRental } from './use-cases/return-rental';
import { RentalsController } from './rentals.controller';
import { CreateRentalResponseInterceptor } from './create-rental-response.interceptor';
import { RentalsRepository } from './rentals.repository';

@Module({
  imports: [AuthModule],
  controllers: [RentalsController],
  providers: [
    RentalsService,
    RentalsRepository,
    CreateRentalResponseInterceptor,
    IssueRental,
    CancelRental,
    ReturnRental,
    ExpireBooking,
    MarkRentalOverdue,
    ProcessRentalDeadlines,
  ],
  exports: [
    RentalsService,
    IssueRental,
    CancelRental,
    ReturnRental,
    ExpireBooking,
    MarkRentalOverdue,
    ProcessRentalDeadlines,
  ],
})
export class RentalsModule {}
