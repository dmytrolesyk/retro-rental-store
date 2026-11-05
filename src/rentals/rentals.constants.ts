export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
// Visible ASCII characters, excluding spaces and control characters.
export const IDEMPOTENCY_KEY_PATTERN = /^[!-~]+$/;
