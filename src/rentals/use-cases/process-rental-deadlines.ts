import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RentalsRepository } from '../rentals.repository';
import type { RentalDeadlineCandidate } from '../rentals.repository';
import { ExpireBooking } from './expire-booking';
import { MarkRentalOverdue } from './mark-rental-overdue';

export const DEADLINE_BATCH_SIZE = 100;

@Injectable()
export class ProcessRentalDeadlines {
  private readonly logger = new Logger(ProcessRentalDeadlines.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly rentalsRepository: RentalsRepository,
    private readonly expireBookingUseCase: ExpireBooking,
    private readonly markRentalOverdueUseCase: MarkRentalOverdue,
  ) {}

  async execute() {
    const cutoff = await this.rentalsRepository.currentTime(this.dataSource.manager);
    const bookingResults = await this.processCandidates(
      'BOOKED',
      cutoff,
      this.expireBookingUseCase,
    );
    const rentalResults = await this.processCandidates(
      'ACTIVE',
      cutoff,
      this.markRentalOverdueUseCase,
    );
    return {
      expiredBookings: bookingResults.changedCount,
      overdueRentals: rentalResults.changedCount,
      failedRentals: bookingResults.failedCount + rentalResults.failedCount,
    };
  }

  private async processCandidates(
    status: 'BOOKED' | 'ACTIVE',
    cutoff: Date,
    deadlineUseCase: ExpireBooking | MarkRentalOverdue,
  ) {
    let cursor: RentalDeadlineCandidate | undefined;
    let changedCount = 0;
    let failedCount = 0;
    for (;;) {
      const candidates = await this.rentalsRepository.findDeadlineCandidates(
        status,
        cutoff,
        DEADLINE_BATCH_SIZE,
        cursor,
      );
      if (!candidates.length) return { changedCount, failedCount };
      for (const candidate of candidates) {
        try {
          if (await deadlineUseCase.execute(candidate.rentalId)) changedCount++;
        } catch (error: unknown) {
          failedCount++;
          this.logger.error(`Failed to process rental deadline: ${candidate.rentalId}`, error);
        }
      }
      // Advance even after a failed row; retry it on the next scheduled run.
      cursor = candidates[candidates.length - 1];
    }
  }
}
