import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { filter, Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import type { RentalStatusChanged } from '../rentals/rental-status-event';
import { publicRentalStatusEvent } from '../rentals/rental-status-event';

/** API-local fan-out. Publication does not acknowledge browser receipt. */
@Injectable()
export class RentalEventsService implements OnModuleDestroy {
  private readonly subject = new Subject<RentalStatusChanged>();
  readonly events$ = this.subject.asObservable();

  publish(event: RentalStatusChanged): void {
    // Whitelist fields: never spread an ORM entity or its private email delivery context.
    this.subject.next(publicRentalStatusEvent(event));
  }

  forRental(rentalId: string): Observable<RentalStatusChanged> {
    return this.events$.pipe(filter(event => event.rentalId === rentalId));
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
