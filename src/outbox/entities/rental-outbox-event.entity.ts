import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Rental } from '../../rentals/entities/rental.entity';
import type { RentalStatusChanged } from '../../rentals/rental-status-event';
import type { RentalNotification } from '../../jobs/rental-notification';

@Entity('rental_outbox_events')
@Index('idx_rental_outbox_rental_position', ['rentalId', 'position'])
@Index('idx_rental_outbox_rental_status', ['rentalId', 'status'], { unique: true })
@Check(
  'rental_outbox_payload_check',
  "COALESCE(payload->>'eventId', '') = event_id::text AND COALESCE(payload->>'rentalId', '') = rental_id::text AND COALESCE(payload->>'status', '') = status AND COALESCE(payload->>'version', '') = '1' AND COALESCE(payload->>'type', '') = 'rental.status-changed' AND status IN ('BOOKED','ACTIVE','OVERDUE','RETURNED','CANCELLED')",
)
export class RentalOutboxEvent {
  @PrimaryColumn({
    name: 'event_id',
    type: 'uuid',
    primaryKeyConstraintName: 'rental_outbox_events_pkey',
  })
  eventId: string;

  // Insertion order, not a cross-rental commit cursor. Parent locks serialize a rental's events.
  @Column({ type: 'bigint', generated: 'increment' })
  position: string;

  @Column({ name: 'rental_id', type: 'uuid' })
  rentalId: string;

  @Column({ type: 'text' })
  status: Rental['status'];

  @Column({ type: 'jsonb' })
  payload: RentalStatusChanged;

  // Private delivery context. Never publish this entity directly to the public stream.
  @Column({ name: 'email_to', type: 'varchar', length: 120 })
  emailTo: string;

  @Column({ name: 'email_notification', type: 'jsonb' })
  emailNotification: RentalNotification;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => Rental, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'rental_id', foreignKeyConstraintName: 'rental_outbox_rental_fkey' })
  rental: Relation<Rental>;
}
