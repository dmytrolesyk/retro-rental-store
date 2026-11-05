import { nextRentalStatus, InvalidRentalTransitionError } from './rental-lifecycle';
import type { RentalCommand, RentalStatus } from './rental-lifecycle';

describe('rental lifecycle', () => {
  it.each([
    ['BOOKED', 'issue', 'ACTIVE'],
    ['BOOKED', 'cancel', 'CANCELLED'],
    ['ACTIVE', 'markOverdue', 'OVERDUE'],
    ['ACTIVE', 'return', 'RETURNED'],
    ['OVERDUE', 'return', 'RETURNED'],
  ] as const)('%s + %s becomes %s', (status, command, expected) => {
    expect(nextRentalStatus(status, command)).toBe(expected);
  });

  it.each([
    ['ACTIVE', 'issue'],
    ['CANCELLED', 'cancel'],
    ['RETURNED', 'return'],
    ['OVERDUE', 'markOverdue'],
  ] as const)('recognizes %s + %s as already completed', (status, command) => {
    expect(nextRentalStatus(status, command)).toBeNull();
  });

  it('rejects every other state/command pair, including cancellation after issue', () => {
    const allowed = new Set([
      'BOOKED:issue',
      'BOOKED:cancel',
      'ACTIVE:markOverdue',
      'ACTIVE:return',
      'OVERDUE:return',
      'ACTIVE:issue',
      'CANCELLED:cancel',
      'RETURNED:return',
      'OVERDUE:markOverdue',
    ]);
    const statuses: RentalStatus[] = ['BOOKED', 'ACTIVE', 'OVERDUE', 'RETURNED', 'CANCELLED'];
    const commands: RentalCommand[] = ['issue', 'cancel', 'return', 'markOverdue'];
    for (const status of statuses)
      for (const command of commands) {
        if (!allowed.has(`${status}:${command}`)) {
          expect(() => nextRentalStatus(status, command)).toThrow(InvalidRentalTransitionError);
        }
      }
  });
});
