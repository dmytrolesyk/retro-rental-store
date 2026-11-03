import { EmailDeliveryError } from '../email/email.service';
import { emailRetry, EMAIL_RETRY_WINDOW_MS } from './email-retry';

describe('email retry policy', () => {
  const start = new Date('2026-11-03T12:00:00Z');
  it('backs off temporary failures and stops permanent errors', () => {
    expect(emailRetry(new Error('network'), 1, start, start)).toMatchObject({
      status: 'new',
      nextAttemptAt: new Date(start.getTime() + 2000),
    });
    expect(
      emailRetry(new EmailDeliveryError('validation_error', false, 'Invalid'), 1, start, start)
        .status,
    ).toBe('failed');
  });
  it('never schedules a request outside the provider key retention window', () => {
    const now = new Date(start.getTime() + EMAIL_RETRY_WINDOW_MS - 1000);
    expect(emailRetry(new Error('lost acknowledgement'), 1, start, now)).toMatchObject({
      status: 'failed',
      lastError: 'retry_window_expired',
    });
  });
});
