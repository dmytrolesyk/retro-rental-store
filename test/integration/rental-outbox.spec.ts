import {
  Rental,
  RentalJob,
  Renter,
  RentalOutboxEvent,
  RentalOutboxDelivery,
} from '../../src/database/entities';
import { RentalsRepository } from '../../src/rentals/rentals.repository';
import { RentalEventsService } from '../../src/realtime/rental-events.service';
import { OutboxRepository } from '../../src/outbox/outbox.repository';
import { QueueRentalStatusEmail } from '../../src/outbox/queue-rental-status-email';
import { ProcessRentalOutbox } from '../../src/outbox/process-rental-outbox';
import { aRental, aRenter } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';
import type { RentalStatusChanged } from '../../src/rentals/rental-status-event';

describe('rental transactional outbox', () => {
  let kit: PostgresTestkit;
  let stopPostgres: (() => Promise<void>) | undefined;
  let rentalsRepository: RentalsRepository;
  let outboxRepository: OutboxRepository;
  let rentalEventsService: RentalEventsService;
  const processor = () =>
    new ProcessRentalOutbox(outboxRepository, new QueueRentalStatusEmail(), rentalEventsService);
  beforeAll(async () => {
    kit = await startPostgres();
    stopPostgres = () => kit.stop();
  });
  beforeEach(async () => {
    await kit.reset();
    rentalsRepository = new RentalsRepository(kit.dataSource);
    outboxRepository = new OutboxRepository(kit.dataSource);
    rentalEventsService = new RentalEventsService();
  });
  afterEach(() => {
    rentalEventsService.onModuleDestroy();
  });
  afterAll(async () => {
    await stopPostgres?.();
  });

  async function record() {
    const renter = await kit.dataSource.getRepository(Renter).save(aRenter());
    const rental = await kit.dataSource.getRepository(Rental).save(aRental(renter.renterId));
    await kit.dataSource.transaction(manager =>
      rentalsRepository.recordStatusChange(manager, rental.rentalId, 'BOOKED', rental.rentedAt),
    );
    const event = await kit.dataSource
      .getRepository(RentalOutboxEvent)
      .findOneByOrFail({ rentalId: rental.rentalId });
    return { renter, rental, event };
  }

  it('persists the event and both delivery intents before any job or publication', async () => {
    const { event } = await record();
    expect(event.payload).toMatchObject({
      eventId: event.eventId,
      previousStatus: 'BOOKED',
      status: 'ACTIVE',
    });
    expect(await kit.dataSource.getRepository(RentalOutboxDelivery).count()).toBe(2);
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(0);
    expect(await processor().execute()).toMatchObject({
      emailQueued: 1,
      realtimePublished: 1,
      failed: 0,
    });
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(1);
  });

  it('rolls back the state and event together', async () => {
    const { rental } = await record();
    await expect(
      kit.dataSource.transaction(async manager => {
        await manager.update(Rental, rental.rentalId, { status: 'OVERDUE' });
        await rentalsRepository.recordStatusChange(manager, rental.rentalId, 'ACTIVE', new Date());
        throw new Error('Injected rollback');
      }),
    ).rejects.toThrow('Injected');
    expect(
      (await kit.dataSource.getRepository(Rental).findOneByOrFail({ rentalId: rental.rentalId }))
        .status,
    ).toBe('ACTIVE');
    expect(await kit.dataSource.getRepository(RentalOutboxEvent).count()).toBe(1);
    expect(await kit.dataSource.getRepository(RentalOutboxDelivery).count()).toBe(2);
  });

  it('recovers committed work in a fresh dispatcher and deduplicates repeated email processing', async () => {
    const { event } = await record();
    const restarted = new ProcessRentalOutbox(
      new OutboxRepository(kit.dataSource),
      new QueueRentalStatusEmail(),
      rentalEventsService,
    );
    expect(await restarted.execute()).toMatchObject({ emailQueued: 1, realtimePublished: 1 });
    const original = await kit.dataSource
      .getRepository(RentalJob)
      .findOneByOrFail({ outboxEventId: event.eventId });
    await kit.dataSource
      .getRepository(RentalOutboxDelivery)
      .update({ eventId: event.eventId, consumer: 'email' }, { processedAt: null });
    expect(await restarted.execute()).toMatchObject({ emailQueued: 1, realtimePublished: 0 });
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(1);
    expect(
      (
        await kit.dataSource
          .getRepository(RentalJob)
          .findOneByOrFail({ outboxEventId: event.eventId })
      ).jobId,
    ).toBe(original.jobId);
  });

  it('freezes recipient and rendered text before delayed dispatch while keeping them off the stream', async () => {
    const { renter, event } = await record();
    await kit.dataSource
      .getRepository(Renter)
      .update(renter.renterId, { email: 'changed@example.test' });
    const events: RentalStatusChanged[] = [];
    const subscription = rentalEventsService.events$.subscribe(value => events.push(value));
    await processor().execute();
    subscription.unsubscribe();
    const job = await kit.dataSource
      .getRepository(RentalJob)
      .findOneByOrFail({ outboxEventId: event.eventId });
    expect(job.emailTo).toBe(renter.email);
    expect(job.notification).toEqual(event.emailNotification);
    expect(events).toEqual([event.payload]);
    expect(events[0]).not.toHaveProperty('emailTo');
    expect(events[0]).not.toHaveProperty('emailNotification');
    expect(Object.isFrozen(events[0])).toBe(true);
  });

  it('persists backoff after an SQL handler failure, continues realtime and other rentals', async () => {
    const first = await record();
    await kit.dataSource.query(
      `CREATE FUNCTION fail_outbox_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected email handler failure'; END $$`,
    );
    await kit.dataSource.query(
      'CREATE TRIGGER fail_outbox_email BEFORE INSERT ON rental_jobs FOR EACH ROW EXECUTE FUNCTION fail_outbox_email()',
    );
    try {
      expect(await processor().execute()).toEqual({
        emailQueued: 0,
        realtimePublished: 1,
        failed: 1,
      });
      const delivery = await kit.dataSource
        .getRepository(RentalOutboxDelivery)
        .findOneByOrFail({ eventId: first.event.eventId, consumer: 'email' });
      expect(delivery).toMatchObject({
        processedAt: null,
        attempts: 1,
        lastError: 'handler_failed',
      });
      expect(delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(await processor().execute()).toEqual({
        emailQueued: 0,
        realtimePublished: 0,
        failed: 0,
      });
    } finally {
      await kit.dataSource.query('DROP TRIGGER fail_outbox_email ON rental_jobs');
      await kit.dataSource.query('DROP FUNCTION fail_outbox_email()');
    }
    await record();
    expect(await processor().execute()).toEqual({
      emailQueued: 1,
      realtimePublished: 1,
      failed: 0,
    });
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(1);
    await kit.dataSource
      .getRepository(RentalOutboxDelivery)
      .update({ eventId: first.event.eventId, consumer: 'email' }, { nextAttemptAt: new Date(0) });
    expect(await processor().execute()).toMatchObject({ emailQueued: 1 });
  });

  it('rolls back email job creation if the corresponding delivery acknowledgement fails', async () => {
    const { event } = await record();
    await kit.dataSource.query(
      `CREATE FUNCTION fail_email_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.consumer = 'email' AND NEW.processed_at IS NOT NULL THEN RAISE EXCEPTION 'Injected ack failure'; END IF; RETURN NEW; END $$`,
    );
    await kit.dataSource.query(
      'CREATE TRIGGER fail_email_ack BEFORE UPDATE ON rental_outbox_deliveries FOR EACH ROW EXECUTE FUNCTION fail_email_ack()',
    );
    try {
      expect(await processor().execute()).toEqual({
        emailQueued: 0,
        realtimePublished: 1,
        failed: 1,
      });
      expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(0);
      expect(
        await kit.dataSource
          .getRepository(RentalOutboxDelivery)
          .findOneByOrFail({ eventId: event.eventId, consumer: 'email' }),
      ).toMatchObject({ attempts: 1, processedAt: null });
    } finally {
      await kit.dataSource.query('DROP TRIGGER fail_email_ack ON rental_outbox_deliveries');
      await kit.dataSource.query('DROP FUNCTION fail_email_ack()');
    }
    await kit.dataSource
      .getRepository(RentalOutboxDelivery)
      .update({ eventId: event.eventId, consumer: 'email' }, { nextAttemptAt: new Date(0) });
    expect(await processor().execute()).toMatchObject({ emailQueued: 1 });
  });

  it('keeps per-rental consumer order even when an earlier delivery is delayed', async () => {
    const { rental, event } = await record();
    await kit.dataSource.transaction(async manager => {
      await rentalsRepository.findForUpdate(manager, rental.rentalId);
      await manager.update(Rental, rental.rentalId, { status: 'OVERDUE' });
      await rentalsRepository.recordStatusChange(manager, rental.rentalId, 'ACTIVE', new Date());
    });
    await kit.dataSource
      .getRepository(RentalOutboxDelivery)
      .update(
        { eventId: event.eventId, consumer: 'email' },
        { nextAttemptAt: new Date(Date.now() + 60000) },
      );
    const received: string[] = [];
    const subscription = rentalEventsService
      .forRental(rental.rentalId)
      .subscribe(value => received.push(value.status));
    expect(await processor().execute()).toEqual({
      emailQueued: 0,
      realtimePublished: 2,
      failed: 0,
    });
    expect(received).toEqual(['ACTIVE', 'OVERDUE']);
    subscription.unsubscribe();
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(0);
    await kit.dataSource
      .getRepository(RentalOutboxDelivery)
      .update({ eventId: event.eventId, consumer: 'email' }, { nextAttemptAt: new Date(0) });
    expect(await processor().execute()).toMatchObject({ emailQueued: 2 });
  });

  it('does not overtake a locked earlier event and allows the other consumer to proceed', async () => {
    const { rental, event } = await record();
    await kit.dataSource.transaction(async manager => {
      await manager.update(Rental, rental.rentalId, { status: 'OVERDUE' });
      await rentalsRepository.recordStatusChange(manager, rental.rentalId, 'ACTIVE', new Date());
    });
    const writer = kit.dataSource.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    try {
      await writer.query(
        "SELECT event_id FROM rental_outbox_deliveries WHERE event_id = $1 AND consumer = 'realtime' FOR UPDATE",
        [event.eventId],
      );
      expect(await processor().execute()).toEqual({
        emailQueued: 2,
        realtimePublished: 0,
        failed: 0,
      });
    } finally {
      await writer.rollbackTransaction();
      await writer.release();
    }
    expect(await processor().execute()).toMatchObject({ realtimePublished: 2 });
  });

  it('coordinates simultaneous dispatchers without duplicate jobs or concurrent publication', async () => {
    await record();
    const events: string[] = [];
    const subscription = rentalEventsService.events$.subscribe(event => events.push(event.eventId));
    const results = await Promise.all([processor().execute(), processor().execute()]);
    subscription.unsubscribe();
    expect(results.reduce((sum, result) => sum + result.emailQueued, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.realtimePublished, 0)).toBe(1);
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(1);
    expect(events).toHaveLength(1);
  });

  it('repeats the same public event ID after publication succeeds but its acknowledgement rolls back', async () => {
    const { event } = await record();
    const received: string[] = [];
    const subscription = rentalEventsService.events$.subscribe(value =>
      received.push(value.eventId),
    );
    await kit.dataSource.query(
      `CREATE FUNCTION fail_realtime_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.consumer = 'realtime' AND NEW.processed_at IS NOT NULL THEN RAISE EXCEPTION 'Injected realtime ack failure'; END IF; RETURN NEW; END $$`,
    );
    await kit.dataSource.query(
      'CREATE TRIGGER fail_realtime_ack BEFORE UPDATE ON rental_outbox_deliveries FOR EACH ROW EXECUTE FUNCTION fail_realtime_ack()',
    );
    try {
      expect(await processor().execute()).toEqual({
        emailQueued: 1,
        realtimePublished: 0,
        failed: 1,
      });
    } finally {
      await kit.dataSource.query('DROP TRIGGER fail_realtime_ack ON rental_outbox_deliveries');
      await kit.dataSource.query('DROP FUNCTION fail_realtime_ack()');
    }
    expect(received).toEqual([event.eventId]);
    await kit.dataSource
      .getRepository(RentalOutboxDelivery)
      .update({ eventId: event.eventId, consumer: 'realtime' }, { nextAttemptAt: new Date(0) });
    expect(await processor().execute()).toMatchObject({ realtimePublished: 1 });
    subscription.unsubscribe();
    expect(received).toEqual([event.eventId, event.eventId]);
  });

  it('limits each scan, retaining excess work for the next scan', async () => {
    for (let index = 0; index < 51; index++) await record();
    const first = await processor().execute();
    expect(first.emailQueued + first.realtimePublished + first.failed).toBe(100);
    expect(await processor().execute()).toEqual({
      emailQueued: 1,
      realtimePublished: 1,
      failed: 0,
    });
  });

  it('preserves existing jobs during migration and refuses to discard new event history', async () => {
    const renter = await kit.dataSource.getRepository(Renter).save(aRenter());
    const rental = await kit.dataSource.getRepository(Rental).save(aRental(renter.renterId));
    const job = await kit.dataSource
      .getRepository(RentalJob)
      .save({ rentalId: rental.rentalId, emailTo: renter.email });
    await kit.dataSource.undoLastMigration();
    await kit.dataSource.runMigrations();
    expect(
      await kit.dataSource.getRepository(RentalJob).findOneByOrFail({ jobId: job.jobId }),
    ).toMatchObject({ status: 'new', emailTo: renter.email, outboxEventId: null });
    expect(await kit.dataSource.getRepository(RentalOutboxEvent).count()).toBe(0);
    await record();
    await expect(kit.dataSource.undoLastMigration()).rejects.toThrow(
      'Cannot discard rental outbox history',
    );
  });

  it('keeps outbox entities and migration metadata aligned', async () => {
    const diff = await kit.dataSource.driver.createSchemaBuilder().log();
    expect(
      diff.upQueries.map(query => query.query).filter(sql => /rental_outbox|rental_jobs/.test(sql)),
    ).toEqual([]);
  });

  it('plans retry wakeups from the earliest eligible head, ignoring blocked newer events', async () => {
    expect(await outboxRepository.nextRetryDelayMs()).toBeNull();
    const { rental, event } = await record();
    await kit.dataSource.query(
      "UPDATE rental_outbox_deliveries SET next_attempt_at = clock_timestamp() + interval '20 seconds' WHERE event_id = $1",
      [event.eventId],
    );
    await kit.dataSource.transaction(async manager => {
      await manager.update(Rental, rental.rentalId, { status: 'OVERDUE' });
      await rentalsRepository.recordStatusChange(manager, rental.rentalId, 'ACTIVE', new Date());
    });
    const delayMs = await outboxRepository.nextRetryDelayMs();
    expect(delayMs).toBeGreaterThan(15000);
    expect(delayMs).toBeLessThanOrEqual(20000);
    await kit.dataSource.query(
      "UPDATE rental_outbox_deliveries SET next_attempt_at = clock_timestamp() - interval '1 second'",
    );
    expect(await outboxRepository.nextRetryDelayMs()).toBeLessThan(0);
    await processor().execute();
    expect(await outboxRepository.nextRetryDelayMs()).toBeNull();
  });
});
