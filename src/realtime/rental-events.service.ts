import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { filter, Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import type { RentalStatusChanged } from '../rentals/rental-status-event';

/** API-local fan-out. Publication does not acknowledge browser receipt. */
@Injectable()
export class RentalEventsService implements OnModuleDestroy {
  private readonly subject = new Subject<RentalStatusChanged>();
  readonly events$ = this.subject.asObservable();

  publish(event: RentalStatusChanged): void {
    // Whitelist fields: never spread an ORM entity or its private email delivery context.
    this.subject.next(
      Object.freeze({
        eventId: event.eventId,
        type: event.type,
        version: event.version,
        rentalId: event.rentalId,
        previousStatus: event.previousStatus,
        status: event.status,
        occurredAt: event.occurredAt,
        bookedAt: event.bookedAt,
        bookingExpiresAt: event.bookingExpiresAt,
        rentedAt: event.rentedAt,
        dueAt: event.dueAt,
        cancelledAt: event.cancelledAt,
        cancellationReason: event.cancellationReason,
      }),
    );
  }

  forRental(rentalId: string): Observable<RentalStatusChanged> {
    return this.events$.pipe(filter(event => event.rentalId === rentalId));
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
