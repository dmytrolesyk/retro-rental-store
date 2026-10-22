import { Injectable, Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

export interface TransactionRetryEvent {
  code: '40001' | '40P01';
  attempt: number;
  delayMs: number;
}

interface RetryOptions {
  maxAttempts?: number;
  onRetry?: (event: TransactionRetryEvent) => void;
}

@Injectable()
export class TransactionRetryService {
  private readonly logger = new Logger(TransactionRetryService.name);

  constructor(private readonly db: DataSource) {}

  async run<T>(
    isolation: IsolationLevel,
    work: (manager: EntityManager, attempt: number) => Promise<T>,
    options: RetryOptions = {},
  ): Promise<T> {
    const maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('maxAttempts must be a positive integer');
    }
    let attempt = 1;
    // Every path either returns, throws, or advances toward maxAttempts.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      try {
        // TypeORM rolls back and releases the connection before a rejected
        // transaction reaches catch. Each retry starts a fresh transaction.
        return await this.db.transaction(isolation, manager => work(manager, attempt));
      } catch (error: unknown) {
        const code = retryableCode(error);
        if (!code || attempt >= maxAttempts) throw error;
        const delayMs = Math.min(50 * 2 ** (attempt - 1), 1000) + Math.floor(Math.random() * 25);
        const event = { code, attempt, delayMs };
        if (options.onRetry) options.onRetry(event);
        else
          this.logger.warn(
            `Transaction failed: ${code}; attempt ${String(attempt)}/${String(maxAttempts)}; retry in ${String(delayMs)} ms`,
          );
        await delay(delayMs);
        attempt++;
      }
    }
  }
}

function retryableCode(error: unknown): TransactionRetryEvent['code'] | undefined {
  // TypeORM QueryFailedError copies the driver's SQLSTATE onto the outer error.
  if (typeof error !== 'object' || error === null || !('code' in error)) return;
  if (error.code === '40001' || error.code === '40P01') return error.code;
}
