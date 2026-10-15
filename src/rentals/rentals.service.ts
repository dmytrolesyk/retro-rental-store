import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { checkout } from './checkout';
import type { CheckoutRequest, CheckoutResult } from './checkout';

@Injectable()
export class RentalsService {
  constructor(private readonly dataSource: DataSource) {}

  checkout(request: CheckoutRequest): Promise<CheckoutResult> {
    return checkout(this.dataSource, request);
  }
}
