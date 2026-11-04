import { nextOutboxAttempt } from './outbox-retry';

describe('outbox retry backoff', () => {
  it('retries indefinitely with a bounded pause', () => {
    const now = new Date('2026-11-03T12:00:00Z');
    expect(nextOutboxAttempt(1, now).getTime() - now.getTime()).toBe(2000);
    expect(nextOutboxAttempt(100, now).getTime() - now.getTime()).toBe(60000);
  });
});
