import { setTimeout as delay } from 'node:timers/promises';
import type { Resend } from 'resend';
import { Rental, RentalJob, Renter } from '../../src/database/entities';
import { EmailService } from '../../src/email/email.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { RentalNotificationWorker } from '../../src/jobs/rental-notification.worker';
import { rentalNotification } from '../../src/jobs/rental-notification';
import { RentalsRepository } from '../../src/rentals/rentals.repository';
import { aRental, aRenter } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';

describe('transactional rental email queue', () => {
  let kit: PostgresTestkit;
  let stopPostgres: (() => Promise<void>) | undefined;
  let jobsService: JobsService;
  let rentalsRepository: RentalsRepository;
  const send = jest.fn<
    ReturnType<Resend['emails']['send']>,
    Parameters<Resend['emails']['send']>
  >();
  const worker = (from = 'original@example.test') =>
    new RentalNotificationWorker(jobsService, new EmailService({ emails: { send } }, from));

  beforeAll(async () => {
    kit = await startPostgres();
    stopPostgres = () => kit.stop();
  });
  beforeEach(async () => {
    await kit.reset();
    jobsService = new JobsService(kit.dataSource);
    rentalsRepository = new RentalsRepository(kit.dataSource);
    send.mockReset().mockResolvedValue({ data: { id: 'accepted' }, error: null, headers: null });
  });
  afterAll(async () => {
    await stopPostgres?.();
  });

  async function queued(statusEmail = true) {
    const renter = await kit.dataSource.getRepository(Renter).save(aRenter());
    const rental = await kit.dataSource.getRepository(Rental).save(aRental(renter.renterId));
    if (statusEmail)
      await kit.dataSource.getRepository(RentalJob).save({
        rentalId: rental.rentalId,
        emailTo: renter.email,
        notificationStatus: rental.status,
        notification: rentalNotification(rental, rental.rentedAt),
      });
    else
      await kit.dataSource
        .getRepository(RentalJob)
        .save({ rentalId: rental.rentalId, emailTo: renter.email });
    const job = await kit.dataSource
      .getRepository(RentalJob)
      .findOneByOrFail({ rentalId: rental.rentalId });
    return { rental, renter, job };
  }
  const readJob = (jobId: string) =>
    kit.dataSource.getRepository(RentalJob).findOneByOrFail({ jobId });
  const ready = (jobId: string) =>
    kit.dataSource.getRepository(RentalJob).update(jobId, { nextAttemptAt: new Date(0) });

  it('keeps the issued snapshot after later status and profile changes; repeated delivery is a no-op', async () => {
    const { rental, renter, job } = await queued();
    await kit.dataSource
      .getRepository(Renter)
      .update(renter.renterId, { email: 'changed@example.test' });
    await kit.dataSource.getRepository(Rental).update(rental.rentalId, { status: 'OVERDUE' });
    expect(await worker().tick()).toBe('done');
    expect(await worker().tick()).toBe('idle');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain('ACTIVE');
    expect(send.mock.calls[0][0]).toMatchObject({
      to: renter.email,
    });
    expect(await readJob(job.jobId)).toMatchObject({ status: 'done', attempts: 1, processed: 1 });
  });

  it('rolls back both status and queued email on transaction failure', async () => {
    const { rental, job } = await queued();
    await expect(
      kit.dataSource.transaction(async manager => {
        await manager.update(Rental, rental.rentalId, { status: 'OVERDUE' });
        await rentalsRepository.recordStatusChange(manager, rental.rentalId, 'ACTIVE', new Date());
        throw new Error('Injected transaction failure');
      }),
    ).rejects.toThrow('Injected');
    expect(
      (await kit.dataSource.getRepository(Rental).findOneByOrFail({ rentalId: rental.rentalId }))
        .status,
    ).toBe('ACTIVE');
    expect(await kit.dataSource.getRepository(RentalJob).count()).toBe(1);
    expect((await readJob(job.jobId)).status).toBe('new');
  });

  it('retains the exact request and sender across temporary failure and a worker restart', async () => {
    const { job } = await queued();
    send.mockResolvedValueOnce({
      data: null,
      headers: null,
      error: { name: 'rate_limit_exceeded', message: 'Slow down', statusCode: 429 },
    });
    expect(await worker().tick()).toBe('failed');
    expect(await readJob(job.jobId)).toMatchObject({
      status: 'new',
      attempts: 1,
      processed: 0,
      lastError: 'rate_limit_exceeded',
    });
    expect(await worker().tick()).toBe('idle');
    await ready(job.jobId);
    expect(await worker('new-sender@example.test').tick()).toBe('done');
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(send.mock.calls[1][1]?.idempotencyKey).toBe(send.mock.calls[0][1]?.idempotencyKey);
    expect(await readJob(job.jobId)).toMatchObject({ processed: 1, attempts: 2, lastError: null });
  });

  it('retains permanent failures while continuing with other jobs', async () => {
    const first = await queued();
    const second = await queued();
    send.mockResolvedValueOnce({
      data: null,
      headers: null,
      error: { name: 'validation_error', message: 'Bad address', statusCode: 422 },
    });
    expect(await worker().tick([first.job.jobId])).toBe('failed');
    expect((await readJob(first.job.jobId)).status).toBe('failed');
    expect(await worker().tick([second.job.jobId])).toBe('done');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not resend after the idempotency safety window expires', async () => {
    const { job } = await queued();
    send.mockRejectedValueOnce(new Error('connection lost'));
    await worker().tick();
    await kit.dataSource.getRepository(RentalJob).update(job.jobId, {
      firstAttemptAt: new Date(Date.now() - 24 * 3600000),
      nextAttemptAt: new Date(0),
    });
    expect(await worker().tick()).toBe('failed');
    expect(send).toHaveBeenCalledTimes(1);
    expect(await readJob(job.jobId)).toMatchObject({
      status: 'failed',
      lastError: 'retry_window_expired',
    });
  });

  it('serializes concurrent workers without sending the same job twice', async () => {
    const { job } = await queued();
    let started!: () => void;
    const sending = new Promise<void>(resolve => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    send.mockImplementationOnce(async () => {
      started();
      await gate;
      return { data: { id: 'accepted' }, error: null, headers: null };
    });
    const first = worker().tick([job.jobId]);
    try {
      await sending;
      expect(await worker().tick([job.jobId])).toBe('idle');
    } finally {
      release();
    }
    expect(await first).toBe('done');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps a prepared request when the delivery transaction rolls back after provider acceptance', async () => {
    const { job } = await queued();
    await jobsService.prepareNextEmail(() => ({
      from: 'frozen@example.test',
      to: job.emailTo,
      subject: 'Pinned',
      text: 'Pinned text',
      idempotencyKey: `rental-status/${job.jobId}`,
    }));
    await kit.dataSource.query(
      `CREATE FUNCTION fail_email_done() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'done' THEN RAISE EXCEPTION 'Injected commit failure'; END IF; RETURN NEW; END $$`,
    );
    await kit.dataSource.query(
      'CREATE TRIGGER fail_email_done BEFORE UPDATE ON rental_jobs FOR EACH ROW EXECUTE FUNCTION fail_email_done()',
    );
    try {
      await expect(worker().tick()).rejects.toThrow('Injected');
    } finally {
      await kit.dataSource.query('DROP TRIGGER fail_email_done ON rental_jobs');
      await kit.dataSource.query('DROP FUNCTION fail_email_done()');
    }
    expect((await readJob(job.jobId)).deliveryPayload?.from).toBe('frozen@example.test');
    expect(await worker('rotated@example.test').tick()).toBe('done');
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
  });

  it('keeps legacy confirmations and their original provider keys', async () => {
    const { job } = await queued(false);
    await worker().tick();
    expect(send.mock.calls[0][1]?.idempotencyKey).toBe(`rental-confirmation/${job.jobId}`);
    expect(send.mock.calls[0][0]).toMatchObject({
      subject: 'Підтвердження оренди — Retro Games Rental',
    });
  });

  it('does not report selected deferred or permanently failed jobs as completed', async () => {
    const { job } = await queued();
    await kit.dataSource
      .getRepository(RentalJob)
      .update(job.jobId, { nextAttemptAt: new Date(Date.now() + 60000) });
    await expect(worker().run([job.jobId])).rejects.toThrow('deferred');
    await kit.dataSource.getRepository(RentalJob).update(job.jobId, { status: 'failed' });
    await expect(worker().run([job.jobId])).rejects.toThrow('failed');
    expect(send).not.toHaveBeenCalled();
  });

  it('waits on a locked selected job instead of reporting success before its owner rolls back', async () => {
    const { job } = await queued();
    const writer = kit.dataSource.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    await writer.query('SELECT job_id FROM rental_jobs WHERE job_id = $1 FOR UPDATE', [job.jobId]);
    let observed!: () => void;
    const waiting = new Promise<void>(resolve => {
      observed = resolve;
    });
    const spy = jest.spyOn(jobsService, 'emailBatchState').mockImplementationOnce(() => {
      observed();
      return Promise.resolve('waiting' as const);
    });
    const pending = worker().run([job.jobId]);
    try {
      await waiting;
      expect(send).not.toHaveBeenCalled();
      await writer.rollbackTransaction();
      await pending;
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
      await pending;
      spy.mockRestore();
    }
  });

  it('waits for newly committed work and shuts down on abort', async () => {
    const controller = new AbortController();
    const running = worker().runForever(controller.signal);
    try {
      const { job } = await queued();
      for (
        let attempt = 0;
        attempt < 150 && (await readJob(job.jobId)).status !== 'done';
        attempt++
      )
        await delay(20);
      expect((await readJob(job.jobId)).status).toBe('done');
    } finally {
      controller.abort();
      await running;
    }
  });

  it('migrates pending legacy jobs without inventing a lifecycle snapshot and guards rollback', async () => {
    const { job } = await queued(false);
    await kit.dataSource.undoLastMigration(); // Outbox has no events in this worker fixture.
    await kit.dataSource.undoLastMigration();
    await kit.dataSource.runMigrations();
    expect(await readJob(job.jobId)).toMatchObject({
      notification: null,
      notificationStatus: null,
      attempts: 0,
    });
    await worker().tick();
    await kit.dataSource.undoLastMigration(); // Revert outbox before testing the notification guard.
    await expect(kit.dataSource.undoLastMigration()).rejects.toThrow('Cannot discard');
    await kit.dataSource.runMigrations();
    expect((await readJob(job.jobId)).status).toBe('done');
  });

  it('enforces snapshot consistency and keeps job metadata aligned with migrations', async () => {
    const { job } = await queued(false);
    await expect(
      kit.dataSource.query(
        "UPDATE rental_jobs SET notification_status = 'ACTIVE', notification = '{}'::jsonb WHERE job_id = $1",
        [job.jobId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const diff = await kit.dataSource.driver.createSchemaBuilder().log();
    expect(
      diff.upQueries.map(query => query.query).filter(sql => sql.includes('rental_jobs')),
    ).toEqual([]);
  });
});
