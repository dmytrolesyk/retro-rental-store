import { rentalNotification } from './rental-notification';

describe('rental status email', () => {
  const rental = {
    rentalId: 'rental-1',
    status: 'BOOKED' as const,
    bookingExpiresAt: new Date('2026-11-04T12:00:00Z'),
    dueAt: null,
    cancellationReason: null,
  };
  it('describes collection and its deadline without claiming payment', () => {
    const snapshot = rentalNotification(rental, new Date('2026-11-03T12:00:00Z'));
    expect(snapshot.status).toBe('BOOKED');
    expect(snapshot.text).toContain('2026-11-04T12:00:00.000Z');
    expect(snapshot.text).toContain('заброньовано');
    expect(snapshot.text).not.toContain('сплачено');
  });
  it('captures the cancellation reason and physical return distinctly', () => {
    const cancelled = rentalNotification(
      { ...rental, status: 'CANCELLED', cancellationReason: 'Не забрали' },
      new Date(),
    );
    expect(cancelled.text).toContain('Не забрали');
    expect(rentalNotification({ ...rental, status: 'RETURNED' }, new Date()).text).toContain(
      'повернення',
    );
  });
});
