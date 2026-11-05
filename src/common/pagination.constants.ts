export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_CURSOR_LENGTH = 512;
export const CURSOR_VERSION = 1;

// URL-safe Base64 alphabet: letters, digits, underscore and hyphen; no padding.
export const BASE64URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
// Decimal notation only: reject signs, leading zeroes, fractions and exponents.
export const PAGE_SIZE_PATTERN = /^[1-9]\d{0,2}$/;
