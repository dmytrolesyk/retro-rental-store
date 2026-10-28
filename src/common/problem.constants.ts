import { HttpStatus } from '@nestjs/common';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
export const PROBLEM_TYPE_PREFIX = 'urn:retro-rental:problem:';
export const INTERNAL_ERROR_DETAIL = 'Internal server error';
export const SERVER_ERROR_STATUS_MIN = 500;

export const PROBLEM_DESCRIPTIONS = {
  [HttpStatus.BAD_REQUEST]: 'Invalid request',
  [HttpStatus.NOT_FOUND]: 'Resource not found',
  [HttpStatus.CONFLICT]: 'Business state conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Idempotency key used with a different request',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Unexpected server error',
} as const;
