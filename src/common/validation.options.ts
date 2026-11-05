import type { ValidationPipeOptions } from '@nestjs/common';

export const HTTP_VALIDATION_OPTIONS = {
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  validateCustomDecorators: true,
  transformOptions: { enableImplicitConversion: false },
  validationError: { target: false, value: false },
} satisfies ValidationPipeOptions;
