import { Transform } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  CURSOR_VERSION,
  DEFAULT_PAGE_SIZE,
  MAX_CURSOR_LENGTH,
  MAX_PAGE_SIZE,
  PAGE_SIZE_PATTERN,
} from './pagination.constants';

export class PaginationQueryDto {
  // Convert only canonical decimal strings; Number() alone accepts whitespace and exponents.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && PAGE_SIZE_PATTERN.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, MAX_CURSOR_LENGTH)
  cursor?: string;
}

export class PaginationCursorDto {
  @Equals(CURSOR_VERSION)
  v: number;

  @IsIn(['games', 'rentals'])
  resource: 'games' | 'rentals';

  @IsUUID('all')
  after: string;
}
