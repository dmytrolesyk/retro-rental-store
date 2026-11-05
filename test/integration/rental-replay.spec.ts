import { RentalStatusEventWriter } from '../../src/rentals/rental-status-event.writer';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setImmediate as tick } from 'node:timers/promises';
import { firstValueFrom, take, timeout, toArray } from 'rxjs';
import type { Observable } from 'rxjs';
import {
  Rental,
  Renter,
  RentalOutboxEvent,
  RentalOutboxDelivery,
} from '../../src/database/entities';
import { RentalsRepository } from '../../src/rentals/rentals.repository';
import type { RentalStatusChanged } from '../../src/rentals/rental-status-event';
import type { RentalHistoryEntry } from '../../src/realtime/rental-event-history.repository';
import { RentalEventHistoryRepository } from '../../src/realtime/rental-event-history.repository';
import { RentalReplayService } from '../../src/realtime/rental-replay.service';
import { RentalEventsService } from '../../src/realtime/rental-events.service';
import { ProcessRentalOutbox } from '../../src/outbox/process-rental-outbox';
import { OutboxRepository } from '../../src/outbox/outbox.repository';
import { QueueRentalStatusEmail } from '../../src/outbox/queue-rental-status-email';
import { aRental, aRenter } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';

const staff = { id: 'staff', role: 'staff' as const };
const collect = (stream: Observable<RentalStatusChanged>, count: number) =>
  firstValueFrom(stream.pipe(take(count), toArray(), timeout(5000)));

const rentalStatusEventWriter = new RentalStatusEventWriter();

describe('durable rental replay', () => {
  let kit: PostgresTestkit;
  let stopPostgres: (() => Promise<void>) | undefined;
  let rentals: RentalsRepository;
  let history: RentalEventHistoryRepository;
  let bus: RentalEventsService;
  let replay: RentalReplayService;
  beforeAll(async () => {
    kit = await startPostgres();
    stopPostgres = () => kit.stop();
  });
  beforeEach(async () => {
    await kit.reset();
    rentals = new RentalsRepository(kit.dataSource);
    history = new RentalEventHistoryRepository(kit.dataSource);
    bus = new RentalEventsService();
    replay = new RentalReplayService(history, bus);
  });
  afterEach(() => {
    replay.onModuleDestroy();
    bus.onModuleDestroy();
  });
  afterAll(async () => {
    await stopPostgres?.();
  });

  async function fixture() {
    const renter = await kit.dataSource.getRepository(Renter).save(aRenter());
    const rental = await kit.dataSource.getRepository(Rental).save(aRental(renter.renterId));
    return { rental, owner: { id: 'client', role: 'client' as const, renterId: renter.renterId } };
  }

  async function record(
    rentalId: string,
    status: Rental['status'],
    previous: Rental['status'] | null,
  ) {
    await kit.dataSource.transaction(async manager => {
      await rentals.findForUpdate(manager, rentalId);
      await manager.update(Rental, rentalId, { status });
      await rentalStatusEventWriter.recordStatusChange(manager, rentalId, previous, new Date());
    });
    return kit.dataSource.getRepository(RentalOutboxEvent).findOneByOrFail({ rentalId, status });
  }

  it('replays committed unpublished events in order, isolates rentals and resumes by UUID', async () => {
    const { rental, owner } = await fixture();
    const active = await record(rental.rentalId, 'ACTIVE', 'BOOKED');
    const overdue = await record(rental.rentalId, 'OVERDUE', 'ACTIVE');
    const other = await fixture();
    await record(other.rental.rentalId, 'ACTIVE', 'BOOKED');
    const returned = await record(rental.rentalId, 'RETURNED', 'OVERDUE');
    expect(await collect(await replay.open(rental.rentalId, owner), 3)).toEqual([
      active.payload,
      overdue.payload,
      returned.payload,
    ]);
    const received = await collect(await replay.open(rental.rentalId, owner, active.eventId), 2);
    expect(received).toEqual([overdue.payload, returned.payload]);
    expect(Object.isFrozen(received[0])).toBe(true);
    expect(received[0]).not.toHaveProperty('emailTo');
    expect(received[0]).not.toHaveProperty('position');
    expect(await kit.dataSource.getRepository(RentalOutboxDelivery).count()).toBe(8);
    expect(
      await kit.dataSource.query(
        'SELECT count(*)::int AS count FROM rental_outbox_deliveries WHERE processed_at IS NOT NULL',
      ),
    ).toEqual([{ count: 0 }]);
  });

  it('uses identical errors for foreign, unknown and malformed cursors after access checks', async () => {
    const first = await fixture();
    const second = await fixture();
    const foreign = await record(second.rental.rentalId, 'ACTIVE', 'BOOKED');
    for (const cursor of [foreign.eventId, randomUUID(), '3', '']) {
      await expect(replay.open(first.rental.rentalId, first.owner, cursor)).rejects.toEqual(
        new BadRequestException('Invalid rental event cursor'),
      );
    }
    await expect(replay.open(second.rental.rentalId, first.owner, 'bad')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('catches history/live overlap and suppresses later dispatcher publication of replayed events', async () => {
    const { rental, owner } = await fixture();
    await record(rental.rentalId, 'ACTIVE', 'BOOKED');
    const reader = new RentalEventHistoryRepository(kit.dataSource);
    const reads: Promise<RentalHistoryEntry[]>[] = [];
    let overlap = true;
    jest.spyOn(history, 'readAfter').mockImplementation((id, position) => {
      const result = (async () => {
        const snapshot = await reader.readAfter(id, position);
        if (overlap) {
          overlap = false;
          const overdue = await record(rental.rentalId, 'OVERDUE', 'ACTIVE');
          bus.publish(overdue.payload);
        }
        return snapshot;
      })();
      reads.push(result);
      return result;
    });
    const received: string[] = [];
    const stream = await replay.open(rental.rentalId, owner);
    let resolveCaughtUp!: () => void;
    const caughtUp = new Promise<void>(resolve => {
      resolveCaughtUp = resolve;
    });
    const subscription = stream.subscribe(event => {
      received.push(event.status);
      if (event.status === 'OVERDUE') resolveCaughtUp();
    });
    await caughtUp;
    expect(received).toEqual(['ACTIVE', 'OVERDUE']);
    const processor = new ProcessRentalOutbox(
      new OutboxRepository(kit.dataSource),
      new QueueRentalStatusEmail(),
      bus,
    );
    await processor.execute();
    for (let index = 0; index < reads.length; index++) await reads[index];
    await tick();
    subscription.unsubscribe();
    expect(received).toEqual(['ACTIVE', 'OVERDUE']);
  });

  it('recovers processed history with fresh service instances after restart', async () => {
    const { rental, owner } = await fixture();
    const active = await record(rental.rentalId, 'ACTIVE', 'BOOKED');
    const overdue = await record(rental.rentalId, 'OVERDUE', 'ACTIVE');
    await new ProcessRentalOutbox(
      new OutboxRepository(kit.dataSource),
      new QueueRentalStatusEmail(),
      bus,
    ).execute();
    replay.onModuleDestroy();
    bus.onModuleDestroy();
    bus = new RentalEventsService();
    replay = new RentalReplayService(new RentalEventHistoryRepository(kit.dataSource), bus);
    expect(await collect(await replay.open(rental.rentalId, owner, active.eventId), 1)).toEqual([
      overdue.payload,
    ]);
  });

  it('preserves bigint cursor precision and strips private fields from stored payloads', async () => {
    const { rental, owner } = await fixture();
    await kit.dataSource.query(
      "SELECT setval(pg_get_serial_sequence('rental_outbox_events', 'position'), 9007199254740993, false)",
    );
    const active = await record(rental.rentalId, 'ACTIVE', 'BOOKED');
    const overdue = await record(rental.rentalId, 'OVERDUE', 'ACTIVE');
    await kit.dataSource.query(
      `UPDATE rental_outbox_events SET payload = payload || '{"emailTo":"private@example.test","emailNotification":{"text":"secret"}}'::jsonb WHERE event_id = $1`,
      [overdue.eventId],
    );
    expect(await history.findCursor(rental.rentalId, active.eventId)).toBe('9007199254740993');
    const result = await collect(await replay.open(rental.rentalId, owner, active.eventId), 1);
    expect(result).toEqual([overdue.payload]);
    expect(result[0]).not.toHaveProperty('emailTo');
    expect(result[0]).not.toHaveProperty('emailNotification');
  });

  it('does not expose uncommitted or rolled-back history and invents no legacy events', async () => {
    const { rental, owner } = await fixture();
    expect(await history.readAfter(rental.rentalId, null)).toEqual([]);
    const writer = kit.dataSource.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    try {
      await rentals.findForUpdate(writer.manager, rental.rentalId);
      await rentalStatusEventWriter.recordStatusChange(
        writer.manager,
        rental.rentalId,
        'BOOKED',
        new Date(),
      );
      expect(await history.readAfter(rental.rentalId, null)).toEqual([]);
    } finally {
      await writer.rollbackTransaction();
      await writer.release();
    }
    expect(await history.readAfter(rental.rentalId, null)).toEqual([]);
    const stream = await replay.open(rental.rentalId, owner);
    const next = collect(stream, 1);
    const event = await record(rental.rentalId, 'ACTIVE', 'BOOKED');
    bus.publish(event.payload);
    expect(await next).toEqual([event.payload]);
  });

  it('does not skip a lower position committed after another rental with a higher position', async () => {
    const first = await fixture();
    const second = await fixture();
    const writer = kit.dataSource.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    try {
      await rentals.findForUpdate(writer.manager, first.rental.rentalId);
      await rentalStatusEventWriter.recordStatusChange(
        writer.manager,
        first.rental.rentalId,
        'BOOKED',
        new Date(),
      );
      const lower = await writer.manager.findOneByOrFail(RentalOutboxEvent, {
        rentalId: first.rental.rentalId,
      });
      const higher = await record(second.rental.rentalId, 'ACTIVE', 'BOOKED');
      expect(BigInt(lower.position)).toBeLessThan(BigInt(higher.position));
      expect(await collect(await replay.open(second.rental.rentalId, staff), 1)).toEqual([
        higher.payload,
      ]);
      expect(await history.readAfter(first.rental.rentalId, null)).toEqual([]);
      const next = collect(await replay.open(first.rental.rentalId, staff), 1);
      await writer.commitTransaction();
      bus.publish(lower.payload);
      expect(await next).toEqual([lower.payload]);
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
    }
  });
});
