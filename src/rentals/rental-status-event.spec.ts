import { rentalStatusChanged } from './rental-status-event';

describe('rental status event', () => {
  it('captures a public fact without leaking recipient or email content', () => {
    const event = rentalStatusChanged(
      'event-1',
      {
        rentalId: 'rental-1',
        status: 'ACTIVE',
        bookedAt: null,
        bookingExpiresAt: null,
        rentedAt: new Date('2026-11-03T12:00:00Z'),
        dueAt: new Date('2026-11-04T12:00:00Z'),
        cancelledAt: null,
        cancellationReason: null,
      },
      'BOOKED',
      new Date('2026-11-03T12:00:00Z'),
    );
    expect(event).toMatchObject({
      eventId: 'event-1',
      type: 'rental.status-changed',
      version: 1,
      previousStatus: 'BOOKED',
      status: 'ACTIVE',
      dueAt: '2026-11-04T12:00:00.000Z',
    });
    expect(event).not.toHaveProperty('emailTo');
    expect(event).not.toHaveProperty('subject');
    expect(event).not.toHaveProperty('text');
  });
});
