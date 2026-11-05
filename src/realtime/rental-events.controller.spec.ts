import { Logger } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { of, throwError, toArray, firstValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import type { Principal } from '../auth/principal';
import { rentalStatusChanged } from '../rentals/rental-status-event';
import type { RentalStatusChanged } from '../rentals/rental-status-event';
import { RentalReplayService } from './rental-replay.service';
import { RentalEventsController } from './rental-events.controller';
import { readSseCursor } from './sse-cursor';

describe('Nest rental SSE controller', () => {
  const rentalId = randomUUID();
  const principal: Principal = { id: randomUUID(), role: 'staff' };
  const request = { headers: {}, rawHeaders: [] } as unknown as Request;
  let open: jest.Mock<
    Promise<Observable<RentalStatusChanged>>,
    [string, Principal, string | undefined]
  >;
  let controller: RentalEventsController;
  beforeEach(() => {
    open = jest.fn<
      Promise<Observable<RentalStatusChanged>>,
      [string, Principal, string | undefined]
    >();
    controller = new RentalEventsController({ open } as unknown as RentalReplayService);
  });

  it('awaits access/cursor preparation and maps public messages with explicit UUID and retry', async () => {
    const event = rentalStatusChanged(
      randomUUID(),
      {
        rentalId,
        status: 'ACTIVE',
        bookedAt: null,
        bookingExpiresAt: null,
        rentedAt: null,
        dueAt: null,
        cancelledAt: null,
        cancellationReason: 'line1\nline2',
      },
      'BOOKED',
      new Date(),
    );
    open.mockResolvedValue(of(event));
    const stream = await controller.events(rentalId, principal, request);
    const result = await firstValueFrom(stream.pipe(toArray()));
    expect(open).toHaveBeenCalledWith(rentalId, principal, undefined);
    expect(result).toEqual([
      { comment: 'connected' },
      { id: event.eventId, type: 'rental.status', data: event, retry: 1000 },
    ]);
  });

  it('preserves setup errors for normal HTTP exception handling', async () => {
    const error = new Error('Access failed');
    open.mockRejectedValue(error);
    await expect(controller.events(rentalId, principal, request)).rejects.toBe(error);
  });

  it('completes after source failure without a raw-error SSE event or numeric ID', async () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      open.mockResolvedValue(throwError(() => new Error('PRIVATE SQL details')));
      const stream = await controller.events(rentalId, principal, request);
      const received: MessageEvent[] = await firstValueFrom(stream.pipe(toArray()));
      expect(received).toEqual([{ comment: 'connected' }]);
    } finally {
      logger.mockRestore();
    }
  });

  it('rejects empty/duplicate header values while allowing absence and a UUID', () => {
    const uuid = randomUUID();
    expect(readSseCursor({ headers: {}, rawHeaders: [] })).toBeUndefined();
    expect(
      readSseCursor({ headers: { 'last-event-id': uuid }, rawHeaders: ['Last-Event-ID', uuid] }),
    ).toBe(uuid);
    expect(() =>
      readSseCursor({ headers: { 'last-event-id': '' }, rawHeaders: ['Last-Event-ID', ''] }),
    ).toThrow('Invalid event cursor');
    expect(() =>
      readSseCursor({
        headers: { 'last-event-id': uuid },
        rawHeaders: ['Last-Event-ID', uuid, 'last-event-id', uuid],
      }),
    ).toThrow('Invalid event cursor');
  });
});
