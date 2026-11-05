import {
  Body,
  Controller,
  Get,
  createParamDecorator,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { RentalsService } from './rentals.service';
import type { CreateRentalResult } from './rentals.types';
import { CreateRentalResponseInterceptor } from './create-rental-response.interceptor';
import {
  CreatedRentalDto,
  CreateRentalDto,
  RentalRequestHeadersDto,
  RentalDetailDto,
  RentalPageDto,
} from './rentals.dto';
import { ApiPagination } from '../common/api-pagination.decorator';
import { ApiProblems } from '../common/api-problems.decorator';
import { PaginationPipe } from '../common/pagination';
import type { PageQuery } from '../common/pagination';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MIN_IDEMPOTENCY_KEY_LENGTH,
} from './rentals.constants';

// Unlike @Headers(), custom parameter decorators support parameter-level pipes.
// Select only the relevant header; the global ValidationPipe validates this DTO.
const RequestHeaders = createParamDecorator((_data: unknown, context: ExecutionContext) => ({
  idempotencyKey: context.switchToHttp().getRequest<Request>().get(IDEMPOTENCY_KEY_HEADER),
}));

@ApiTags('rentals')
@Controller('rentals')
export class RentalsController {
  constructor(private readonly rentals: RentalsService) {}

  @Post()
  @UseInterceptors(CreateRentalResponseInterceptor)
  @ApiOperation({ operationId: 'createRental', summary: 'Rent one available copy for one day' })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    schema: {
      type: 'string',
      minLength: MIN_IDEMPOTENCY_KEY_LENGTH,
      maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
      pattern: IDEMPOTENCY_KEY_PATTERN.source,
    },
    description:
      'Client-generated opaque key. The same key and validated body replay the original 201 response and Location, without another rental, debit or job. JSON property order and UUID case do not affect identity. A different body with the same key returns 422. Keys are stored in PostgreSQL without automatic expiration.',
  })
  @ApiCreatedResponse({
    type: CreatedRentalDto,
    description: 'Rental created, or its original response replayed.',
    headers: {
      Location: {
        description: 'URL of the created rental.',
        schema: { type: 'string', format: 'uri-reference' },
      },
      'Idempotency-Replay': {
        description: 'Whether this is the persisted original response.',
        schema: { type: 'string', enum: ['true', 'false'] },
      },
    },
  })
  @ApiProblems(400, 404, 409, 422, 500)
  create(
    @Body() body: CreateRentalDto,
    @RequestHeaders() headers: RentalRequestHeadersDto,
  ): Promise<CreateRentalResult> {
    return this.rentals.create(body, headers.idempotencyKey);
  }

  @Get()
  @ApiOperation({ operationId: 'listRentals', summary: 'List rentals in stable UUID order' })
  @ApiPagination()
  @ApiOkResponse({ type: RentalPageDto, description: 'One page of rental summaries.' })
  @ApiProblems(400, 500)
  list(@Query(new PaginationPipe('rentals')) page: PageQuery): Promise<RentalPageDto> {
    return this.rentals.list(page);
  }

  @Get(':rentalId')
  @ApiOperation({ operationId: 'getRental', summary: 'Get a rental and its items' })
  @ApiParam({ name: 'rentalId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    type: RentalDetailDto,
    description: 'Rental details with historical item prices.',
  })
  @ApiProblems(400, 404, 500)
  get(@Param('rentalId', new ParseUUIDPipe()) rentalId: string): Promise<RentalDetailDto> {
    return this.rentals.get(rentalId);
  }
}
