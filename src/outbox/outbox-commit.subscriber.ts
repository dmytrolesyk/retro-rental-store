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

/** Track outbox inserts per transaction level so savepoint release does not trigger dispatch. */
@Injectable()
export class OutboxCommitSubscriber
  implements EntitySubscriberInterface<RentalOutboxEvent>, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxCommitSubscriber.name);
  private readonly outboxInsertedByTransactionLevel = new WeakMap<QueryRunner, boolean[]>();

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
    const outboxInsertedByLevel =
      this.outboxInsertedByTransactionLevel.get(event.queryRunner) ?? [];
    outboxInsertedByLevel.push(false);
    this.outboxInsertedByTransactionLevel.set(event.queryRunner, outboxInsertedByLevel);
  }

  afterInsert(event: InsertEvent<RentalOutboxEvent>): void {
    if (!event.queryRunner.isTransactionActive) {
      this.notify();
      return;
    }
    const outboxInsertedByLevel = this.outboxInsertedByTransactionLevel.get(event.queryRunner);
    if (outboxInsertedByLevel?.length)
      outboxInsertedByLevel[outboxInsertedByLevel.length - 1] = true;
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    const outboxInsertedByLevel = this.outboxInsertedByTransactionLevel.get(event.queryRunner);
    if (!outboxInsertedByLevel) return;
    const hasOutboxInsert = outboxInsertedByLevel.pop();
    if (event.queryRunner.isTransactionActive) {
      if (hasOutboxInsert && outboxInsertedByLevel.length)
        outboxInsertedByLevel[outboxInsertedByLevel.length - 1] = true;
      return;
    }
    this.outboxInsertedByTransactionLevel.delete(event.queryRunner);
    if (hasOutboxInsert) this.notify();
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    this.outboxInsertedByTransactionLevel.get(event.queryRunner)?.pop();
    if (!event.queryRunner.isTransactionActive)
      this.outboxInsertedByTransactionLevel.delete(event.queryRunner);
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
