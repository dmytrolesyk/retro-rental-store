import type { DataSource, EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { TransactionRetryService } from './transaction-retry.service';
import type { TransactionRetryEvent } from './transaction-retry.service';

function createService() {
  const transaction = jest.fn(
    async (_isolation: string, work: (manager: EntityManager) => Promise<unknown>) =>
      work({} as EntityManager),
  );
  return {
    service: new TransactionRetryService({ transaction } as unknown as DataSource),
    transaction,
  };
}

describe('TransactionRetryService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each(['40001', '40P01'])(
    'restarts the entire transaction for %s and returns its result',
    async code => {
      const { service, transaction } = createService();
      const attempts: number[] = [];
      const onRetry = jest.fn<undefined, [TransactionRetryEvent]>();
      const result = service.run(
        'REPEATABLE READ',
        (_manager, attempt) => {
          attempts.push(attempt);
          if (attempt === 1)
            throw new QueryFailedError(
              'UPDATE renters',
              [],
              Object.assign(new Error('conflict'), { code }),
            );
          return Promise.resolve(13000);
        },
        { onRetry },
      );
      await jest.runAllTimersAsync();
      await expect(result).resolves.toBe(13000);
      expect(attempts).toEqual([1, 2]);
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ code, attempt: 1 }));
    },
  );

  it.each(['23505', '08006', undefined])('does not retry unrelated errors (%s)', async code => {
    const { service, transaction } = createService();
    const error = Object.assign(new Error('not a concurrency conflict'), { code });
    await expect(service.run('READ COMMITTED', () => Promise.reject(error))).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('stops at the attempt limit and backs off exponentially', async () => {
    const { service, transaction } = createService();
    const error = Object.assign(new Error('conflict'), { code: '40001' });
    const onRetry = jest.fn<undefined, [TransactionRetryEvent]>();
    const result = service.run('SERIALIZABLE', () => Promise.reject(error), {
      maxAttempts: 3,
      onRetry,
    });
    const rejection = expect(result).rejects.toBe(error);
    await jest.runAllTimersAsync();
    await rejection;
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    const delays = onRetry.mock.calls.map(([event]) => event.delayMs);
    expect(delays[0]).toBeGreaterThanOrEqual(50);
    expect(delays[0]).toBeLessThan(75);
    expect(delays[1]).toBeGreaterThanOrEqual(100);
    expect(delays[1]).toBeLessThan(125);
  });

  it('rejects an invalid attempt limit before starting a transaction', async () => {
    const { service, transaction } = createService();
    await expect(
      service.run('READ COMMITTED', () => Promise.resolve(undefined), { maxAttempts: 0 }),
    ).rejects.toThrow('maxAttempts');
    expect(transaction).not.toHaveBeenCalled();
  });
});
