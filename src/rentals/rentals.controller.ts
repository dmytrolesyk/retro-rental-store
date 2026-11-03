import {
  Body,
  Controller,
  Get,
  HttpCode,
  createParamDecorator,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { BearerAuthGuard, CurrentPrincipal } from '../auth/bearer-auth.guard';
import type { Principal } from '../auth/principal';
import { RentalsService } from './rentals.service';
import { IssueRental } from './use-cases/issue-rental';
import { CancelRental } from './use-cases/cancel-rental';
import { ReturnRental } from './use-cases/return-rental';
import type { CreateRentalResult } from './rentals.types';
import { CreateRentalResponseInterceptor } from './create-rental-response.interceptor';
import {
  CreatedRentalDto,
  CancelRentalDto,
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
@ApiBearerAuth()
@UseGuards(BearerAuthGuard)
@Controller('rentals')
export class RentalsController {
  constructor(
    private readonly rentalsService: RentalsService,
    private readonly issueRentalUseCase: IssueRental,
    private readonly cancelRentalUseCase: CancelRental,
    private readonly returnRentalUseCase: ReturnRental,
  ) {}

  @Post()
  @UseInterceptors(CreateRentalResponseInterceptor)
  @ApiOperation({
    operationId: 'createRental',
    summary: 'Reserve one available copy for 24 hours without payment',
  })
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
      'Client-generated opaque key. The same key and validated body replay the original 201 response and Location, without another booking. No payment is taken at booking. A legacy checkout key returns 409; use a new key. JSON property order and UUID case do not affect identity. A different body with the same key returns 422. Keys are stored in PostgreSQL without automatic expiration.',
  })
  @ApiCreatedResponse({
    type: CreatedRentalDto,
    description:
      'Booking created, or its original BOOKED receipt replayed regardless of the current lifecycle state.',
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
  @ApiProblems(400, 401, 403, 404, 409, 422, 500)
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateRentalDto,
    @RequestHeaders() headers: RentalRequestHeadersDto,
  ): Promise<CreateRentalResult> {
    return this.rentalsService.create(body, headers.idempotencyKey, principal);
  }

  @Post(':rentalId/issue')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'issueRental',
    summary: 'Staff issues a booked copy and charges its fixed price once',
  })
  @ApiParam({ name: 'rentalId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    type: RentalDetailDto,
    description:
      'Issued rental; repeated issue while ACTIVE returns the current state without charging again.',
  })
  @ApiProblems(400, 401, 403, 404, 409, 500)
  issue(
    @CurrentPrincipal() principal: Principal,
    @Param('rentalId', new ParseUUIDPipe()) rentalId: string,
  ): Promise<RentalDetailDto> {
    return this.issueRentalUseCase.execute(rentalId, principal);
  }

  @Post(':rentalId/cancel')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'cancelRental',
    summary: 'Owner or staff cancels a booking and releases the reserved copy',
  })
  @ApiParam({ name: 'rentalId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    type: RentalDetailDto,
    description: 'Cancelled booking; repeat preserves the first cancellation reason and actor.',
  })
  @ApiProblems(400, 401, 403, 404, 409, 500)
  cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('rentalId', new ParseUUIDPipe()) rentalId: string,
    @Body() body: CancelRentalDto,
  ): Promise<RentalDetailDto> {
    return this.cancelRentalUseCase.execute(rentalId, principal, body.reason);
  }

  @Post(':rentalId/return')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'returnRental',
    summary: 'Staff accepts all outstanding copies and completes the rental',
  })
  @ApiParam({ name: 'rentalId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    type: RentalDetailDto,
    description:
      'Completed rental; repeat preserves physical return dates. Historical partial returns remain unchanged.',
  })
  @ApiProblems(400, 401, 403, 404, 409, 500)
  returnRental(
    @CurrentPrincipal() principal: Principal,
    @Param('rentalId', new ParseUUIDPipe()) rentalId: string,
  ): Promise<RentalDetailDto> {
    return this.returnRentalUseCase.execute(rentalId, principal);
  }

  @Get()
  @ApiOperation({ operationId: 'listRentals', summary: 'List rentals in stable UUID order' })
  @ApiPagination()
  @ApiOkResponse({ type: RentalPageDto, description: 'One page of rental summaries.' })
  @ApiProblems(400, 401, 500)
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new PaginationPipe('rentals')) page: PageQuery,
  ): Promise<RentalPageDto> {
    return this.rentalsService.list(page, principal);
  }

  @Get(':rentalId')
  @ApiOperation({ operationId: 'getRental', summary: 'Get a rental and its items' })
  @ApiParam({ name: 'rentalId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    type: RentalDetailDto,
    description: 'Rental details with historical item prices.',
  })
  @ApiProblems(400, 401, 403, 404, 500)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('rentalId', new ParseUUIDPipe()) rentalId: string,
  ): Promise<RentalDetailDto> {
    return this.rentalsService.get(rentalId, principal);
  }
}
