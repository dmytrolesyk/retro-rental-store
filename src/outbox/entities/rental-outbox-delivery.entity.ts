import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { RentalOutboxEvent } from './rental-outbox-event.entity';

export type OutboxConsumer = 'email' | 'realtime';

@Entity('rental_outbox_deliveries')
@Check('rental_outbox_consumer_check', "consumer IN ('email','realtime')")
@Check('rental_outbox_attempts_check', 'attempts >= 0')
@Index('idx_rental_outbox_ready', ['consumer', 'nextAttemptAt', 'eventId'], {
  where: 'processed_at IS NULL',
})
export class RentalOutboxDelivery {
  @PrimaryColumn({
    name: 'event_id',
    type: 'uuid',
    primaryKeyConstraintName: 'rental_outbox_deliveries_pkey',
  })
  eventId: string;

  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'rental_outbox_deliveries_pkey' })
  consumer: OutboxConsumer;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt: Date;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @ManyToOne(() => RentalOutboxEvent, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'event_id', foreignKeyConstraintName: 'rental_outbox_delivery_event_fkey' })
  event: Relation<RentalOutboxEvent>;
}
