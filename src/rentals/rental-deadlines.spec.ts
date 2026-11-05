import { nextDeadlineStatus } from './rental-deadlines';
import type { RentalStatus } from './rental-lifecycle';

describe('Rental deadline rules', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');
  const earlier = new Date(now.getTime() - 1);
  const later = new Date(now.getTime() + 1);

  it.each([
    ['BOOKED', later, null],
    ['BOOKED', now, 'CANCELLED'],
    ['BOOKED', earlier, 'CANCELLED'],
    ['ACTIVE', later, null],
    ['ACTIVE', now, 'OVERDUE'],
    ['ACTIVE', earlier, 'OVERDUE'],
  ] as const)('%s with deadline %s yields %s', (status, deadline, expected) => {
    const rental = {
      status,
      bookingExpiresAt: status === 'BOOKED' ? deadline : earlier,
      dueAt: status === 'ACTIVE' ? deadline : earlier,
    };
    expect(nextDeadlineStatus(rental, now)).toBe(expected);
  });

  it.each(['OVERDUE', 'RETURNED', 'CANCELLED'] satisfies RentalStatus[])(
    'ignores %s even when both dates have passed',
    status => {
      expect(
        nextDeadlineStatus({ status, bookingExpiresAt: earlier, dueAt: earlier }, now),
      ).toBeNull();
    },
  );

  it.each(['BOOKED', 'ACTIVE'] satisfies RentalStatus[])(
    'does not invent a missing deadline for %s',
    status => {
      expect(nextDeadlineStatus({ status, bookingExpiresAt: null, dueAt: null }, now)).toBeNull();
    },
  );
});
