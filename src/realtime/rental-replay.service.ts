import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Observable, Subject, takeUntil } from 'rxjs';
import { assertRentalAccess } from '../auth/rental-access';
import type { Principal } from '../auth/principal';
import type { RentalStatusChanged } from '../rentals/rental-status-event';
import {
  RentalEventHistoryRepository,
  RENTAL_HISTORY_PAGE_SIZE,
} from './rental-event-history.repository';
import { RentalEventsService } from './rental-events.service';

/** One API instance. Subject signals invalidate history; their payloads are never merged into it. */
@Injectable()
export class RentalReplayService implements OnModuleDestroy {
  private stopping = false;
  private readonly stopped = new Subject<void>();

  constructor(
    private readonly history: RentalEventHistoryRepository,
    private readonly events: RentalEventsService,
  ) {}

  /** Prepare before opening a transport response; reads start on subscription. */
  async open(
    rentalId: string,
    principal: Principal,
    cursor?: string,
  ): Promise<Observable<RentalStatusChanged>> {
    if (this.stopping) throw new ServiceUnavailableException('Rental replay is stopping');
    const normalizedRentalId = rentalId.toLowerCase();
    const owner = await this.history.findOwner(normalizedRentalId);
    if (owner === null) throw new NotFoundException('Rental not found');
    assertRentalAccess(principal, owner, 'read');
    let initialPosition: string | null = null;
    if (cursor !== undefined) {
      if (!isUUID(cursor)) throw new BadRequestException('Invalid rental event cursor');
      initialPosition = await this.history.findCursor(normalizedRentalId, cursor);
      if (initialPosition === null) throw new BadRequestException('Invalid rental event cursor');
    }

    return new Observable<RentalStatusChanged>(subscriber => {
      if (this.stopping) {
        subscriber.complete();
        return;
      }
      const isClosed = (): boolean => subscriber.closed;
      let position = initialPosition;
      let requested = false;
      let running = false;

      const drain = async (): Promise<void> => {
        running = true;
        try {
          while (requested && !isClosed()) {
            requested = false;
            const rows = await this.history.readAfter(normalizedRentalId, position);
            for (const row of rows) {
              if (isClosed()) return;
              subscriber.next(row.event);
              position = row.position;
            }
            if (rows.length === RENTAL_HISTORY_PAGE_SIZE) requested = true;
          }
        } catch (error) {
          subscriber.error(error);
        } finally {
          // No await between the final requested check and clearing running.
          running = false;
        }
      };
      const wake = (): void => {
        requested = true;
        if (!running && !isClosed()) void drain();
      };
      // Install the listener before the first SELECT. Coalesce hints during awaits.
      const signals = this.events.forRental(normalizedRentalId).subscribe({
        next: wake,
        error: (error: unknown) => {
          subscriber.error(error);
        },
        complete: () => {
          subscriber.complete();
        },
      });
      wake();
      // An in-flight SELECT may finish; closed subscribers discard its results.
      return () => {
        signals.unsubscribe();
      };
    }).pipe(takeUntil(this.stopped));
  }

  onModuleDestroy(): void {
    this.stopping = true;
    this.stopped.next();
    this.stopped.complete();
  }
}
