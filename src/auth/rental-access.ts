import { ForbiddenException } from '@nestjs/common';
import type { Principal } from './principal';

export type RentalAction = 'create' | 'read' | 'issue' | 'return' | 'cancel';

/** Shared by business commands, HTTP reads and future realtime subscriptions. */
export function assertRentalAccess(
  principal: Principal,
  renterId: string,
  action: RentalAction,
): void {
  if (principal.role === 'staff' && action !== 'create') return;
  if (
    principal.role === 'client' &&
    principal.renterId === renterId.toLowerCase() &&
    (action === 'create' || action === 'read' || action === 'cancel')
  )
    return;
  throw new ForbiddenException();
}
