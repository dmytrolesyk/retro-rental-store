import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setImmediate as tick } from 'node:timers/promises';
import { take, firstValueFrom, toArray, finalize, timeout } from 'rxjs';
import { RentalEventsService } from './rental-events.service';
import { RentalReplayService } from './rental-replay.service';
import { RentalEventHistoryRepository } from './rental-event-history.repository';
import { rentalStatusChanged } from '../rentals/rental-status-event';
import type { RentalHistoryEntry } from './rental-event-history.repository';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('rental history and live catch-up', () => {
  const rentalId = randomUUID();
  const owner = { id: 'client', role: 'client' as const, renterId: randomUUID() };
  const staff = { id: 'staff', role: 'staff' as const };
  const entry = (position: string): RentalHistoryEntry => ({
    position,
    event: rentalStatusChanged(
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
    ),
  });
  let history: {
    findOwner: jest.Mock<Promise<string | null>, [string]>;
    findCursor: jest.Mock<Promise<string | null>, [string, string]>;
    readAfter: jest.Mock<Promise<RentalHistoryEntry[]>, [string, string | null]>;
  };
  let bus: RentalEventsService;
  let replay: RentalReplayService;
  beforeEach(() => {
    history = {
      findOwner: jest.fn<Promise<string | null>, [string]>().mockResolvedValue(owner.renterId),
      findCursor: jest.fn<Promise<string | null>, [string, string]>().mockResolvedValue(null),
      readAfter: jest
        .fn<Promise<RentalHistoryEntry[]>, [string, string | null]>()
        .mockResolvedValue([]),
    };
    bus = new RentalEventsService();
    replay = new RentalReplayService(history as unknown as RentalEventHistoryRepository, bus);
  });
  afterEach(() => {
    replay.onModuleDestroy();
    bus.onModuleDestroy();
  });

  it('replays from the beginning without waiting for publication', async () => {
    const first = entry('9007199254740993');
    history.readAfter.mockResolvedValueOnce([first]);
    const result = await firstValueFrom(await replay.open(rentalId, owner));
    expect(result).toEqual(first.event);
    expect(history.readAfter).toHaveBeenCalledWith(rentalId, null);
  });

  it('validates access before cursor lookup and permits staff', async () => {
    history.findOwner.mockResolvedValueOnce(null);
    await expect(replay.open(rentalId, owner, 'bad')).rejects.toBeInstanceOf(NotFoundException);
    history.findOwner.mockResolvedValueOnce(randomUUID());
    await expect(replay.open(rentalId, owner, randomUUID())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(history.findCursor).not.toHaveBeenCalled();
    await expect(replay.open(rentalId, staff)).resolves.toBeDefined();
  });

  it('rejects malformed, unknown, foreign and future cursors uniformly', async () => {
    for (const cursor of ['', '3', 'invalid', randomUUID(), randomUUID()]) {
      await expect(replay.open(rentalId, owner, cursor)).rejects.toEqual(
        new BadRequestException('Invalid rental event cursor'),
      );
    }
    expect(history.readAfter).not.toHaveBeenCalled();
  });

  it('coalesces signals during a read and never overlaps reads or repeats an event', async () => {
    const first = entry('108');
    const next = entry('120');
    const pending = deferred<RentalHistoryEntry[]>();
    history.findCursor.mockResolvedValue('101');
    history.readAfter.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([next]);
    const received: string[] = [];
    const stream = await replay.open(rentalId, owner, randomUUID());
    const subscription = stream.subscribe(event => received.push(event.eventId));
    for (let i = 0; i < 100; i++) bus.publish(next.event);
    expect(history.readAfter).toHaveBeenCalledTimes(1);
    pending.resolve([first]);
    await tick();
    expect(received).toEqual([first.event.eventId, next.event.eventId]);
    expect(history.readAfter.mock.calls).toEqual([
      [rentalId, '101'],
      [rentalId, '108'],
    ]);
    bus.publish(first.event);
    await tick();
    expect(received).toHaveLength(2);
    expect(history.readAfter).toHaveBeenLastCalledWith(rentalId, '120');
    subscription.unsubscribe();
  });

  it('does not lose a signal fired synchronously while delivering history', async () => {
    const first = entry('1');
    const next = entry('2');
    history.readAfter.mockResolvedValueOnce([first]).mockResolvedValueOnce([next]);
    const received: string[] = [];
    const subscription = (await replay.open(rentalId, owner)).subscribe(event => {
      received.push(event.eventId);
      if (event.eventId === first.event.eventId) bus.publish(next.event);
    });
    await tick();
    expect(received).toEqual([first.event.eventId, next.event.eventId]);
    subscription.unsubscribe();
  });

  it('ignores other rentals and catches a signal after an empty initial read', async () => {
    const next = entry('20');
    const subscription = (await replay.open(rentalId, owner)).subscribe();
    await tick();
    bus.publish({ ...next.event, rentalId: randomUUID() });
    await tick();
    expect(history.readAfter).toHaveBeenCalledTimes(1);
    bus.publish(next.event);
    await tick();
    expect(history.readAfter).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it('gives each subscription its own cursor and performs no reads before subscribing', async () => {
    const first = entry('1');
    const stream = await replay.open(rentalId, owner);
    expect(history.readAfter).not.toHaveBeenCalled();
    history.readAfter.mockResolvedValue([first]);
    expect(await firstValueFrom(stream.pipe(take(1)))).toEqual(first.event);
    expect(await firstValueFrom(stream.pipe(take(1)))).toEqual(first.event);
    expect(history.readAfter.mock.calls).toEqual([
      [rentalId, null],
      [rentalId, null],
    ]);
  });

  it('drains bounded history pages without requiring another live signal', async () => {
    const page = Array.from({ length: 100 }, (_, index) => entry(String(index + 1)));
    const last = entry('101');
    history.readAfter.mockResolvedValueOnce(page).mockResolvedValueOnce([last]);
    const result = await firstValueFrom(
      (await replay.open(rentalId, owner)).pipe(take(101), toArray()),
    );
    expect(result).toEqual([...page, last].map(row => row.event));
    expect(history.readAfter.mock.calls).toEqual([
      [rentalId, null],
      [rentalId, '100'],
    ]);
  });

  it('matches live hints for uppercase rental UUIDs and releases the signal subscription', async () => {
    const next = entry('1');
    const cleanup = jest.fn();
    const signals = bus.forRental(rentalId).pipe(finalize(cleanup));
    const subscribeToRental = jest.spyOn(bus, 'forRental').mockReturnValue(signals);
    const subscription = (await replay.open(rentalId.toUpperCase(), owner)).subscribe();
    await tick();
    bus.publish(next.event);
    await tick();
    expect(history.readAfter).toHaveBeenCalledTimes(2);
    expect(history.readAfter).toHaveBeenLastCalledWith(rentalId, null);
    expect(subscribeToRental.mock.calls).toEqual([[rentalId]]);
    subscription.unsubscribe();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('uses the last event cursor for an empty history and later emits only the new event', async () => {
    const next = entry('9007199254740995');
    history.findCursor.mockResolvedValue('9007199254740993');
    const result = firstValueFrom(
      (await replay.open(rentalId, owner, randomUUID())).pipe(timeout(1000)),
    );
    await tick();
    history.readAfter.mockResolvedValueOnce([next]);
    bus.publish(next.event);
    expect(await result).toEqual(next.event);
    expect(history.readAfter).toHaveBeenLastCalledWith(rentalId, '9007199254740993');
  });

  it('unsubscribes during an in-flight query and discards its late result', async () => {
    const pending = deferred<RentalHistoryEntry[]>();
    history.readAfter.mockReturnValueOnce(pending.promise);
    const received = jest.fn();
    const subscription = (await replay.open(rentalId, owner)).subscribe(received);
    subscription.unsubscribe();
    const first = entry('1');
    bus.publish(first.event);
    pending.resolve([first]);
    await tick();
    expect(received).not.toHaveBeenCalled();
    expect(history.readAfter).toHaveBeenCalledTimes(1);
  });

  it('terminates on a DB error, removes the live subscription and allows reconnect', async () => {
    const failure = new Error('DB unavailable');
    history.readAfter.mockRejectedValueOnce(failure);
    const error = jest.fn();
    const subscription = (await replay.open(rentalId, owner)).subscribe({ error });
    await tick();
    bus.publish(entry('1').event);
    await tick();
    expect(subscription.closed).toBe(true);
    expect(error).toHaveBeenCalledWith(failure);
    expect(history.readAfter).toHaveBeenCalledTimes(1);
    const first = entry('1');
    history.readAfter.mockResolvedValueOnce([first]);
    expect(await firstValueFrom(await replay.open(rentalId, owner))).toEqual(first.event);
  });

  it('completes active streams and prevents reads from prepared streams after shutdown', async () => {
    const stream = await replay.open(rentalId, owner);
    const subscription = stream.subscribe();
    await tick();
    replay.onModuleDestroy();
    expect(subscription.closed).toBe(true);
    expect(stream.subscribe().closed).toBe(true);
    expect(history.readAfter).toHaveBeenCalledTimes(1);
    await expect(replay.open(rentalId, owner)).rejects.toThrow('Rental replay is stopping');
  });
});
