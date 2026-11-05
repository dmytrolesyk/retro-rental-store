import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setImmediate as tick } from 'node:timers/promises';
import { ConfiguredTokenService } from '../auth/configured-token.service';
import type { Principal } from '../auth/principal';
import type { RentalsService } from '../rentals/rentals.service';
import type { RentalDetailDto } from '../rentals/rentals.dto';
import { rentalStatusChanged } from '../rentals/rental-status-event';
import { RentalEventsService } from './rental-events.service';
import { RentalEventsGateway } from './rental-events.gateway';
import type { RentalSocket, RentalSocketServer } from './rental-socket.contract';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('rental socket lifecycle', () => {
  const rentalId = randomUUID();
  const principal: Principal = { id: randomUUID(), role: 'staff' };
  const detail = {} as RentalDetailDto;
  let getRental: jest.Mock<Promise<RentalDetailDto>, [string, Principal]>;
  let bus: RentalEventsService;
  let gateway: RentalEventsGateway;
  const client = () => ({
    data: { principal },
    connected: true,
    join: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    leave: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    bus = new RentalEventsService();
    getRental = jest.fn<Promise<RentalDetailDto>, [string, Principal]>().mockResolvedValue(detail);
    gateway = new RentalEventsGateway(
      new ConfiguredTokenService([]),
      { get: getRental } as unknown as RentalsService,
      bus,
    );
  });
  afterEach(() => {
    gateway.onModuleDestroy();
    bus.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('acknowledges only after the adapter has completed membership', async () => {
    const socket = client();
    const membership = deferred<undefined>();
    socket.join.mockReturnValueOnce(membership.promise);
    const result = gateway.join(socket as unknown as RentalSocket, {
      rentalId: rentalId.toUpperCase(),
    });
    let acknowledged = false;
    void result.then(() => {
      acknowledged = true;
    });
    await tick();
    expect(socket.join).toHaveBeenCalledWith(`rentals:${rentalId}`);
    expect(acknowledged).toBe(false);
    membership.resolve(undefined);
    expect(await result).toEqual({ ok: true, rentalId });
  });

  it('does not join a socket disconnected during access lookup', async () => {
    const socket = client();
    const lookup = deferred<RentalDetailDto>();
    getRental.mockReturnValueOnce(lookup.promise);
    const result = gateway.join(socket as unknown as RentalSocket, { rentalId });
    socket.connected = false;
    lookup.resolve(detail);
    expect(await result).toEqual({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('cleans late membership if disconnect happens during an asynchronous join', async () => {
    const socket = client();
    const membership = deferred<undefined>();
    socket.join.mockReturnValueOnce(membership.promise);
    const result = gateway.join(socket as unknown as RentalSocket, { rentalId });
    await tick();
    socket.connected = false;
    membership.resolve(undefined);
    expect(await result).toEqual({ ok: false, error: { code: 'DISCONNECTED' } });
    expect(socket.leave).toHaveBeenCalledWith(`rentals:${rentalId}`);
  });

  it('returns a safe ack on unexpected errors and allows subsequent joins', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const socket = client();
    getRental.mockRejectedValueOnce(new Error('Private SQL context must not reach a client'));
    expect(await gateway.join(socket as unknown as RentalSocket, { rentalId })).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(await gateway.join(socket as unknown as RentalSocket, { rentalId })).toEqual({
      ok: true,
      rentalId,
    });
  });

  it('removes its single bus listener on shutdown', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.afterInit({ use: jest.fn(), to } as unknown as RentalSocketServer);
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
        cancellationReason: null,
      },
      'BOOKED',
      new Date(),
    );
    bus.publish(event);
    expect(to).toHaveBeenCalledWith(`rentals:${rentalId}`);
    expect(emit).toHaveBeenCalledWith('rental.status', event);
    gateway.onModuleDestroy();
    bus.publish(event);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
