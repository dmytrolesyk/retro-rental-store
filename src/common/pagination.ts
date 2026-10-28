import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { PaginationCursorDto, PaginationQueryDto } from './pagination.dto';
import { HTTP_VALIDATION_OPTIONS } from './validation.options';
import { BASE64URL_TOKEN_PATTERN, CURSOR_VERSION } from './pagination.constants';

type Resource = 'games' | 'rentals';
export interface PageQuery {
  limit: number;
  after?: string;
}

export class PaginationPipe implements PipeTransform<unknown, Promise<PageQuery>> {
  private readonly validation = new ValidationPipe(HTTP_VALIDATION_OPTIONS);
  constructor(private readonly resource: Resource) {}

  async transform(value: unknown): Promise<PageQuery> {
    const { limit, cursor } = (await this.validation.transform(value, {
      type: 'query',
      metatype: PaginationQueryDto,
    })) as PaginationQueryDto;
    if (!cursor) return { limit };
    try {
      if (!BASE64URL_TOKEN_PATTERN.test(cursor)) throw new Error();
      const decoded = Buffer.from(cursor, 'base64url');
      // Buffer decoding is permissive; accept only the canonical unpadded representation.
      if (decoded.toString('base64url') !== cursor) throw new Error();
      const token = (await this.validation.transform(
        JSON.parse(decoded.toString('utf8')) as unknown,
        {
          type: 'custom',
          metatype: PaginationCursorDto,
        },
      )) as PaginationCursorDto;
      if (token.resource !== this.resource) throw new Error();
      return { limit, after: token.after };
    } catch {
      throw new BadRequestException('Invalid cursor for this resource');
    }
  }
}

export function pageOf<T>(rows: T[], page: PageQuery, resource: Resource, id: (item: T) => string) {
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  const next_cursor =
    rows.length > page.limit && last
      ? Buffer.from(JSON.stringify({ v: CURSOR_VERSION, resource, after: id(last) })).toString(
          'base64url',
        )
      : null;
  return { items, next_cursor };
}
