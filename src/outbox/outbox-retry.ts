/** Outbox dispatch does no external email send; retry until repaired, retaining ordering. */
export function nextOutboxAttempt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)));
}
