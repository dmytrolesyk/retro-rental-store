import { RentalEventsService } from './rental-events.service';
import { rentalStatusChanged } from '../rentals/rental-status-event';

describe('API-local rental event bus', () => {
  it('isolates rentals, strips extra data and freezes the emitted object', () => {
    const bus = new RentalEventsService();
    const event = rentalStatusChanged(
      'event-1',
      {
        rentalId: 'rental-1',
        status: 'BOOKED',
        bookedAt: new Date('2026-11-03T12:00:00Z'),
        bookingExpiresAt: new Date('2026-11-04T12:00:00Z'),
        rentedAt: null,
        dueAt: null,
        cancelledAt: null,
        cancellationReason: null,
      },
      null,
      new Date('2026-11-03T12:00:00Z'),
    );
    const received: unknown[] = [];
    let wrongRental = 0;
    const first = bus.forRental('rental-1').subscribe(value => {
      expect(Reflect.set(value, 'status', 'CANCELLED')).toBe(false);
      received.push(value);
    });
    const second = bus.forRental('rental-2').subscribe(() => wrongRental++);
    bus.publish({ ...event, emailTo: 'private@example.test' } as typeof event);
    expect(received).toEqual([event]);
    expect(wrongRental).toBe(0);
    first.unsubscribe();
    bus.publish(event);
    expect(received).toHaveLength(1);
    bus.onModuleDestroy();
    expect(second.closed).toBe(true);
  });
});
