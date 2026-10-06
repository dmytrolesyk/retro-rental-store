import pg from 'pg';
import { RotationPool } from './rotation-pool';

// Narrow the overloaded pg.connect method to the promise form used by RotationPool.
function spyConnect() {
  return jest.spyOn(pg.Pool.prototype, 'connect') as unknown as jest.SpyInstance<
    Promise<pg.PoolClient>,
    []
  >;
}

describe('RotationPool connection retry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('retries authentication failures while the password file is being published', async () => {
    jest.useFakeTimers();
    const client = Object.assign(new pg.Client(), { release: jest.fn() });
    const connect = spyConnect()
      .mockImplementationOnce(() =>
        Promise.reject(Object.assign(new Error('authentication failed'), { code: '28P01' })),
      )
      .mockImplementationOnce(() => Promise.resolve(client));
    const pool = new RotationPool();
    const result = pool.connect();
    await jest.runAllTimersAsync();
    await expect(result).resolves.toBe(client);
    expect(connect).toHaveBeenCalledTimes(2);
    await pool.end();
  });

  it('does not retry unrelated connection failures', async () => {
    const error = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const connect = spyConnect().mockImplementation(() => Promise.reject(error));
    const pool = new RotationPool();
    await expect(pool.connect()).rejects.toBe(error);
    expect(connect).toHaveBeenCalledTimes(1);
    await pool.end();
  });

  it('stops after four authentication attempts and supports the driver callback', async () => {
    jest.useFakeTimers();
    const error = Object.assign(new Error('authentication failed'), { code: '28P01' });
    const connect = spyConnect().mockImplementation(() => Promise.reject(error));
    const pool = new RotationPool();
    const callback = jest.fn();
    pool.connect(callback);
    await jest.runAllTimersAsync();
    expect(callback).toHaveBeenCalledWith(error, undefined, expect.any(Function));
    expect(connect).toHaveBeenCalledTimes(4);
    await pool.end();
  });
});
