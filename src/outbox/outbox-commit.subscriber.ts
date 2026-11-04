import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  EntitySubscriberInterface,
  InsertEvent,
  QueryRunner,
  TransactionStartEvent,
  TransactionCommitEvent,
  TransactionRollbackEvent,
} from 'typeorm';
import { RentalOutboxEvent } from './entities/rental-outbox-event.entity';
import { RentalOutboxDispatcher } from './rental-outbox.dispatcher';

/** Transaction frames prevent a released savepoint from looking like a durable outer commit. */
@Injectable()
export class OutboxCommitSubscriber
  implements EntitySubscriberInterface<RentalOutboxEvent>, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxCommitSubscriber.name);
  private readonly frames = new WeakMap<QueryRunner, boolean[]>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly rentalOutboxDispatcher: RentalOutboxDispatcher,
  ) {}

  listenTo(): typeof RentalOutboxEvent {
    return RentalOutboxEvent;
  }
  onModuleInit(): void {
    this.dataSource.subscribers.push(this);
  }
  onModuleDestroy(): void {
    const index = this.dataSource.subscribers.indexOf(this);
    if (index >= 0) this.dataSource.subscribers.splice(index, 1);
  }

  afterTransactionStart(event: TransactionStartEvent): void {
    const frames = this.frames.get(event.queryRunner) ?? [];
    frames.push(false);
    this.frames.set(event.queryRunner, frames);
  }

  afterInsert(event: InsertEvent<RentalOutboxEvent>): void {
    if (!event.queryRunner.isTransactionActive) {
      this.notify();
      return;
    }
    const frames = this.frames.get(event.queryRunner);
    if (frames?.length) frames[frames.length - 1] = true;
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    const frames = this.frames.get(event.queryRunner);
    if (!frames) return;
    const changed = frames.pop();
    if (event.queryRunner.isTransactionActive) {
      if (changed && frames.length) frames[frames.length - 1] = true;
      return;
    }
    this.frames.delete(event.queryRunner);
    if (changed) this.notify();
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    this.frames.get(event.queryRunner)?.pop();
    if (!event.queryRunner.isTransactionActive) this.frames.delete(event.queryRunner);
  }

  private notify(): void {
    void Promise.resolve()
      // Forward the result so an unexpected rejected wake promise is contained too.
      // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
      .then(() => this.rentalOutboxDispatcher.wake())
      .catch(() => {
        this.logger.error(
          'Outbox wake failed after commit; fallback scan will recover pending work',
        );
      });
  }
}
