import { EmailDeliveryError } from '../email/email.service';

// Stop before Resend's 24h key retention ends. Ambiguous deliveries need human reconciliation.
export const EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

export function emailRetry(error: unknown, attempts: number, firstAttemptAt: Date, now: Date) {
  const code = error instanceof EmailDeliveryError ? error.code : 'delivery_error';
  const retryable = !(error instanceof EmailDeliveryError) || error.retryable;
  const delayMs = Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(attempts, 12));
  const nextAttemptAt = new Date(now.getTime() + delayMs);
  const withinWindow = nextAttemptAt.getTime() < firstAttemptAt.getTime() + EMAIL_RETRY_WINDOW_MS;
  return {
    status: retryable && withinWindow ? ('new' as const) : ('failed' as const),
    nextAttemptAt,
    lastError: withinWindow ? code : 'retry_window_expired',
  };
}
