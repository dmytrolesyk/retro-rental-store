import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Rental } from '../../rentals/entities/rental.entity';
import type { RentalNotification } from '../rental-notification';
import type { PreparedEmail } from '../../email/email.service';
import { RentalOutboxEvent } from '../../outbox/entities/rental-outbox-event.entity';

@Entity('rental_jobs')
@Index('idx_rental_jobs_outbox_event', ['outboxEventId'], {
  unique: true,
  where: 'outbox_event_id IS NOT NULL',
})
@Check('rental_jobs_status_check', "\"status\" IN ('new', 'done', 'failed')")
@Check('rental_jobs_processed_check', '"processed" >= 0')
@Check('rental_jobs_attempts_check', 'attempts >= 0')
@Check(
  'rental_jobs_notification_check',
  "(notification_status IS NULL AND notification IS NULL) OR (notification_status IS NOT NULL AND notification IS NOT NULL AND notification_status IN ('BOOKED','ACTIVE','OVERDUE','RETURNED','CANCELLED') AND COALESCE(notification->>'status', '') = notification_status AND COALESCE(notification->>'version', '') = '1')",
)
@Index('idx_rental_jobs_status_email', ['rentalId', 'notificationStatus'], {
  unique: true,
  where: 'notification_status IS NOT NULL',
})
@Index('idx_rental_jobs_ready', ['nextAttemptAt', 'createdAt', 'jobId'], {
  where: "status = 'new'",
})
@Index('idx_rental_jobs_rental', ['rentalId'])
@Index('idx_rental_jobs_new', ['createdAt', 'jobId'], { where: '"status" = \'new\'' })
export class RentalJob {
  @PrimaryGeneratedColumn('uuid', { name: 'job_id', primaryKeyConstraintName: 'rental_jobs_pkey' })
  jobId: string;

  @Column({ name: 'rental_id', type: 'uuid' })
  rentalId: string;

  @Column({ name: 'outbox_event_id', type: 'uuid', nullable: true })
  outboxEventId: string | null;

  @ManyToOne(() => RentalOutboxEvent, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'outbox_event_id',
    foreignKeyConstraintName: 'rental_jobs_outbox_event_fkey',
  })
  outboxEvent: Relation<RentalOutboxEvent> | null;

  // Recipient snapshot: changing a renter profile must not change a retry payload.
  @Column({ name: 'email_to', type: 'varchar', length: 120 })
  emailTo: string;

  @Column({ type: 'text', default: 'new' })
  status: 'new' | 'done' | 'failed';

  @Column({ name: 'notification_status', type: 'text', nullable: true })
  notificationStatus: Rental['status'] | null;

  @Column({ type: 'jsonb', nullable: true })
  notification: RentalNotification | null;

  @Column({ name: 'delivery_payload', type: 'jsonb', nullable: true })
  deliveryPayload: PreparedEmail | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt: Date;

  @Column({ name: 'first_attempt_at', type: 'timestamptz', nullable: true })
  firstAttemptAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  // Count completed processing operations; values above 1 expose duplicate processing.
  @Column({ type: 'integer', default: 0 })
  processed: number;

  @Column({ type: 'text', nullable: true })
  worker: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => Rental, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'rental_id',
    referencedColumnName: 'rentalId',
    foreignKeyConstraintName: 'rental_jobs_rental_id_fkey',
  })
  rental: Relation<Rental>;
}
