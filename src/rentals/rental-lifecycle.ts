/** Lifecycle decisions only; credentials, dates and database writes belong to the caller. */
export const RENTAL_STATUSES = ['BOOKED', 'ACTIVE', 'OVERDUE', 'RETURNED', 'CANCELLED'] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];
export type RentalCommand = 'issue' | 'cancel' | 'return' | 'markOverdue';

const transitions: Record<RentalStatus, Partial<Record<RentalCommand, RentalStatus>>> = {
  BOOKED: { issue: 'ACTIVE', cancel: 'CANCELLED' },
  ACTIVE: { return: 'RETURNED', markOverdue: 'OVERDUE' },
  OVERDUE: { return: 'RETURNED' },
  RETURNED: {},
  CANCELLED: {},
};
const completed: Record<RentalCommand, RentalStatus> = {
  issue: 'ACTIVE',
  cancel: 'CANCELLED',
  return: 'RETURNED',
  markOverdue: 'OVERDUE',
};

export class InvalidRentalTransitionError extends Error {
  constructor(status: RentalStatus, command: RentalCommand) {
    super(`Cannot ${command} a ${status} rental`);
    this.name = 'InvalidRentalTransitionError';
  }
}

/** null means no new transition. This does not replace transactional idempotency. */
export function nextRentalStatus(
  status: RentalStatus,
  command: RentalCommand,
): RentalStatus | null {
  if (completed[command] === status) return null;
  const nextStatus = transitions[status][command];
  if (nextStatus === undefined) throw new InvalidRentalTransitionError(status, command);
  return nextStatus;
}
