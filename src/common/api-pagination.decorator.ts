import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination.constants';

export function ApiPagination() {
  return applyDecorators(
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
      description: 'Maximum number of items per page.',
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      type: String,
      description:
        'Opaque token from next_cursor. Pass it unchanged; do not parse or construct it. A token belongs to one resource. Omit for the first page.',
    }),
  );
}
