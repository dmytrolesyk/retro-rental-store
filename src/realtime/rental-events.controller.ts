import {
  Controller,
  Logger,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { BearerAuthGuard, CurrentPrincipal } from '../auth/bearer-auth.guard';
import type { Principal } from '../auth/principal';
import { ApiProblems } from '../common/api-problems.decorator';
import { catchError, EMPTY, map, Observable } from 'rxjs';
import { readSseCursor } from './sse-cursor';
import { rentalSseMessage } from './rental-sse.mapper';
import { withSseHeartbeats } from './sse-heartbeat';
import { RentalReplayService } from './rental-replay.service';

@ApiTags('rentals')
@ApiBearerAuth()
@UseGuards(BearerAuthGuard)
@Controller('rentals')
export class RentalEventsController {
  private readonly logger = new Logger(RentalEventsController.name);

  constructor(private readonly rentalReplayService: RentalReplayService) {}

  @Sse(':id/events')
  @ApiOperation({
    operationId: 'streamRentalEvents',
    summary: 'Stream retained and live rental status events; reconnect after a UUID event cursor',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({
    name: 'Last-Event-ID',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description: 'Last received event UUID for this rental; omitted replays all retained history.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Open SSE stream. Event name rental.status; id is the event UUID; data is public RentalStatusChanged JSON. Control frames do not carry IDs.',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiProblems(400, 401, 403, 404, 500, 503)
  async events(
    @Param('id', new ParseUUIDPipe()) rentalId: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: Request,
  ): Promise<Observable<MessageEvent>> {
    const events = await this.rentalReplayService.open(rentalId, principal, readSseCursor(request));
    return withSseHeartbeats(events.pipe(map(rentalSseMessage))).pipe(
      catchError(() => {
        this.logger.error('Rental SSE stream failed; closing connection');
        return EMPTY;
      }),
    );
  }
}
