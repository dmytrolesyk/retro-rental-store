import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ProcessRentalOutbox, OUTBOX_BATCH_SIZE } from './process-rental-outbox';
import { OutboxRepository } from './outbox.repository';
import { RentalOutboxDispatcher, OUTBOX_RESCAN_MS } from './rental-outbox.dispatcher';

// Unit boundary only: the real ConfigModule is exercised by full-AppModule E2E.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

describe('hybrid outbox dispatcher', () => {
  const empty = { emailQueued: 0, realtimePublished: 0, failed: 0 };
  const full = { ...empty, emailQueued: OUTBOX_BATCH_SIZE };
  let dispatcher: RentalOutboxDispatcher;
  let closeModule: (() => Promise<void>) | undefined;
  let enabled: boolean;
  const execute = jest.fn<Promise<typeof empty>, []>();
  const nextRetryDelayMs = jest.fn<Promise<number | null>, []>();

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    enabled = true;
    execute.mockReset().mockResolvedValue(empty);
    nextRetryDelayMs.mockReset().mockResolvedValue(null);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({
      providers: [
        RentalOutboxDispatcher,
        { provide: ConfigService, useValue: { get: () => enabled } },
        { provide: ProcessRentalOutbox, useValue: { execute } },
        { provide: OutboxRepository, useValue: { nextRetryDelayMs } },
      ],
    }).compile();
    closeModule = () => module.close();
    dispatcher = module.get(RentalOutboxDispatcher);
  });
  afterEach(async () => {
    await closeModule?.();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('checks at startup, then waits for the fallback interval while idle', async () => {
    dispatcher.onApplicationBootstrap();
    await dispatcher.waitForIdle();
    expect(execute).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(OUTBOX_RESCAN_MS - 1);
    expect(execute).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await dispatcher.waitForIdle();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('coalesces a burst and retains one wake received during active work', async () => {
    let started!: () => void;
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => {
      finish = resolve;
    });
    execute.mockImplementationOnce(async () => {
      started();
      await gate;
      return empty;
    });
    for (let index = 0; index < 100; index++) dispatcher.wake();
    await entered;
    expect(execute).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 100; index++) dispatcher.wake();
    expect(execute).toHaveBeenCalledTimes(1);
    finish();
    await dispatcher.waitForIdle();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('continues all full batches immediately, including a backlog larger than five hundred deliveries', async () => {
    for (let batch = 0; batch < 6; batch++) execute.mockResolvedValueOnce(full);
    execute.mockResolvedValueOnce({ ...empty, realtimePublished: 3 });
    dispatcher.wake();
    await dispatcher.waitForIdle();
    expect(execute).toHaveBeenCalledTimes(7);
    expect(nextRetryDelayMs).toHaveBeenCalledTimes(1);
  });

  it('retries on its own timer without waiting for another business event', async () => {
    nextRetryDelayMs.mockResolvedValueOnce(2000);
    dispatcher.wake();
    await dispatcher.waitForIdle();
    await jest.advanceTimersByTimeAsync(1999);
    expect(execute).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await dispatcher.waitForIdle();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('retains a wake that arrives while querying the next retry time', async () => {
    let started!: () => void;
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => {
      finish = resolve;
    });
    nextRetryDelayMs.mockImplementationOnce(async () => {
      started();
      await gate;
      return null;
    });
    dispatcher.wake();
    await entered;
    dispatcher.wake();
    finish();
    await dispatcher.waitForIdle();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('uses fallback after a database error and avoids spinning on due but locked work', async () => {
    execute.mockRejectedValueOnce(new Error('database unavailable'));
    dispatcher.wake();
    await dispatcher.waitForIdle();
    await jest.advanceTimersByTimeAsync(OUTBOX_RESCAN_MS);
    await dispatcher.waitForIdle();
    expect(execute).toHaveBeenCalledTimes(2);
    nextRetryDelayMs.mockResolvedValueOnce(-1000);
    dispatcher.wake();
    await dispatcher.waitForIdle();
    await jest.advanceTimersByTimeAsync(999);
    expect(execute).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1);
    await dispatcher.waitForIdle();
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('does no background work while disabled', async () => {
    enabled = false;
    dispatcher.onApplicationBootstrap();
    dispatcher.wake();
    await jest.advanceTimersByTimeAsync(OUTBOX_RESCAN_MS * 2);
    await dispatcher.waitForIdle();
    expect(execute).not.toHaveBeenCalled();
    expect(nextRetryDelayMs).not.toHaveBeenCalled();
  });

  it('stops between batches, waits for the in-flight batch and ignores later wakes', async () => {
    let started!: () => void;
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => {
      finish = resolve;
    });
    execute.mockImplementationOnce(async () => {
      started();
      await gate;
      return full;
    });
    dispatcher.wake();
    await entered;
    let stopped = false;
    const stopping = dispatcher.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await stopping;
    dispatcher.wake();
    await jest.advanceTimersByTimeAsync(OUTBOX_RESCAN_MS * 2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(nextRetryDelayMs).not.toHaveBeenCalled();
  });

  it('waits for in-flight retry planning during shutdown without installing a timer', async () => {
    let started!: () => void;
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => {
      finish = resolve;
    });
    nextRetryDelayMs.mockImplementationOnce(async () => {
      started();
      await gate;
      return 2000;
    });
    dispatcher.wake();
    await entered;
    let stopped = false;
    const stopping = dispatcher.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await stopping;
    await jest.advanceTimersByTimeAsync(OUTBOX_RESCAN_MS);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
