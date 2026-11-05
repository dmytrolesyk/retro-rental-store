import { BadRequestException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

export function readSseCursor(
  request: Pick<IncomingMessage, 'headers' | 'rawHeaders'>,
): string | undefined {
  const value = request.headers['last-event-id'];
  const count = request.rawHeaders
    .filter((_, index) => index % 2 === 0)
    .filter(name => name.toLowerCase() === 'last-event-id').length;
  if (count === 0 && value === undefined) return undefined;
  if (count !== 1 || typeof value !== 'string' || value.length === 0)
    throw new BadRequestException('Invalid event cursor');
  // Domain-specific cursor validation belongs to the caller.
  return value;
}
