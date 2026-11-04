import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { RentalOutboxDelivery } from './entities/rental-outbox-delivery.entity';
import type { OutboxConsumer } from './entities/rental-outbox-delivery.entity';
import type { RentalOutboxEvent } from './entities/rental-outbox-event.entity';
import { nextOutboxAttempt } from './outbox-retry';

type OutboxHandler = (manager: EntityManager, event: RentalOutboxEvent) => Promise<void>;

const NO_EARLIER_PENDING_DELIVERY = `NOT EXISTS (
  SELECT 1 FROM rental_outbox_deliveries previous
  JOIN rental_outbox_events earlier ON earlier.event_id = previous.event_id
  WHERE earlier.rental_id = event.rental_id AND earlier.position < event.position
    AND previous.consumer = delivery.consumer AND previous.processed_at IS NULL)`;

@Injectable()
export class OutboxRepository {
  constructor(private readonly dataSource: DataSource) {}

  async nextRetryDelayMs(): Promise<number | null> {
    const row = await this.dataSource
      .getRepository(RentalOutboxDelivery)
      .createQueryBuilder('delivery')
      .innerJoin('delivery.event', 'event')
      .select(
        '(EXTRACT(EPOCH FROM (MIN(delivery.nextAttemptAt) - clock_timestamp())) * 1000)::float8',
        'delayMs',
      )
      .where('delivery.processedAt IS NULL')
      .andWhere(NO_EARLIER_PENDING_DELIVERY)
      .getRawOne<{ delayMs: number | null }>();
    return row?.delayMs ?? null;
  }

  processNext(consumer: OutboxConsumer, handle: OutboxHandler): Promise<'done' | 'failed' | null> {
    return this.dataSource.transaction('READ COMMITTED', async manager => {
      const delivery = await manager
        .getRepository(RentalOutboxDelivery)
        .createQueryBuilder('delivery')
        .innerJoinAndSelect('delivery.event', 'event')
        .where('delivery.consumer = :consumer', { consumer })
        .andWhere('delivery.processedAt IS NULL')
        .andWhere('delivery.nextAttemptAt <= clock_timestamp()')
        // Delayed/locked earlier work blocks only this rental and this consumer.
        .andWhere(NO_EARLIER_PENDING_DELIVERY)
        .orderBy('event.position', 'ASC')
        .limit(1)
        .setLock('pessimistic_write', undefined, ['delivery'])
        .setOnLocked('skip_locked')
        .getOne();
      if (!delivery) return null;
      const key = { eventId: delivery.eventId, consumer };
      try {
        // A SQL handler/ack error aborts its savepoint, not the outer retry-state transaction.
        await manager.transaction(async handlerManager => {
          await handle(handlerManager, delivery.event);
          await handlerManager.update(RentalOutboxDelivery, key, {
            processedAt: () => 'clock_timestamp()',
            attempts: delivery.attempts + 1,
            lastError: null,
          });
        });
        return 'done';
      } catch {
        const [clock] = await manager.query<{ now: Date }[]>('SELECT clock_timestamp() AS now');
        await manager.update(RentalOutboxDelivery, key, {
          attempts: delivery.attempts + 1,
          nextAttemptAt: nextOutboxAttempt(delivery.attempts + 1, clock.now),
          lastError: 'handler_failed',
        });
        return 'failed';
      }
    });
  }
}
