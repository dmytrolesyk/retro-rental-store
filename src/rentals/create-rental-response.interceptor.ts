import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';
import type { CreatedRentalDto } from './rentals.dto';
import type { CreateRentalResult } from './rentals.types';

@Injectable()
export class CreateRentalResponseInterceptor implements NestInterceptor<
  CreateRentalResult,
  CreatedRentalDto
> {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  intercept(
    context: ExecutionContext,
    callHandler: CallHandler<CreateRentalResult>,
  ): Observable<CreatedRentalDto> {
    const response = context.switchToHttp().getResponse<unknown>();
    return callHandler.handle().pipe(
      map(creationResult => {
        const httpAdapter = this.httpAdapterHost.httpAdapter;
        httpAdapter.setHeader(response, 'Location', `/rentals/${creationResult.response.rentalId}`);
        httpAdapter.setHeader(response, 'Idempotency-Replay', String(creationResult.replayed));
        return creationResult.response;
      }),
    );
  }
}
