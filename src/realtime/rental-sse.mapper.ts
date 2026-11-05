import type { MessageEvent } from '@nestjs/common';
import { publicRentalStatusEvent } from '../rentals/rental-status-event';
import type { RentalStatusChanged } from '../rentals/rental-status-event';

export const RENTAL_SSE_RETRY_MS = 1000;

export function rentalSseMessage(event: RentalStatusChanged): MessageEvent {
  return {
    id: event.eventId,
    type: 'rental.status',
    data: publicRentalStatusEvent(event),
    retry: RENTAL_SSE_RETRY_MS,
  };
}
