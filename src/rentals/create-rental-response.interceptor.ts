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
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<CreateRentalResult>,
  ): Observable<CreatedRentalDto> {
    const response = context.switchToHttp().getResponse<unknown>();
    return next.handle().pipe(
      map(result => {
        const adapter = this.adapterHost.httpAdapter;
        adapter.setHeader(response, 'Location', `/rentals/${result.response.rentalId}`);
        adapter.setHeader(response, 'Idempotency-Replay', String(result.replayed));
        return result.response;
      }),
    );
  }
}
