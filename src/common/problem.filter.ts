import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CheckoutError } from '../rentals/checkout';
import {
  INTERNAL_ERROR_DETAIL,
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPE_PREFIX,
  SERVER_ERROR_STATUS_MIN,
} from './problem.constants';

const CHECKOUT_ERROR_STATUS = {
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  RENTER_NOT_FOUND: HttpStatus.NOT_FOUND,
  COPY_UNAVAILABLE: HttpStatus.CONFLICT,
  INSUFFICIENT_BALANCE: HttpStatus.CONFLICT,
} satisfies Record<CheckoutError['code'], HttpStatus>;

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = INTERNAL_ERROR_DETAIL;
    if (error instanceof CheckoutError) {
      status = CHECKOUT_ERROR_STATUS[error.code];
      detail = error.message;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      if (status < SERVER_ERROR_STATUS_MIN) {
        const body = error.getResponse();
        detail = typeof body === 'string' ? body : error.message;
        if (typeof body === 'object' && 'message' in body) {
          if (typeof body.message === 'string') detail = body.message;
          else if (Array.isArray(body.message)) detail = body.message.map(String).join('; ');
        }
      }
    }
    if (status >= SERVER_ERROR_STATUS_MIN) this.logger.error(error);
    const title = (HttpStatus[status] ?? 'ERROR').toLowerCase().replaceAll('_', ' ');
    const http = host.switchToHttp();
    http
      .getResponse<Response>()
      .status(status)
      .type(PROBLEM_CONTENT_TYPE)
      .json({
        type: `${PROBLEM_TYPE_PREFIX}${title.replaceAll(' ', '-')}`,
        title,
        status,
        detail,
        instance: http.getRequest<Request>().originalUrl,
      });
  }
}
