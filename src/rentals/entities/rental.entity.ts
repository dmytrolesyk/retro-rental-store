import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Renter } from '../../renters/entities/renter.entity';
import { RentalItem } from './rental-item.entity';
import type { RentalStatus } from '../rental-lifecycle';

@Entity('rentals')
@Check('rentals_status_check', "status IN ('BOOKED','ACTIVE','OVERDUE','RETURNED','CANCELLED')")
@Check(
  'rentals_booking_dates_check',
  '(booked_at IS NULL AND booking_expires_at IS NULL) OR (booked_at IS NOT NULL AND booking_expires_at IS NOT NULL AND booking_expires_at > booked_at)',
)
@Check(
  'rentals_issue_dates_check',
  '(rented_at IS NULL AND due_at IS NULL) OR (rented_at IS NOT NULL AND due_at IS NOT NULL AND due_at > rented_at AND (booked_at IS NULL OR (rented_at >= booked_at AND rented_at < booking_expires_at)))',
)
@Check(
  'rentals_lifecycle_check',
  "(status = 'BOOKED' AND booked_at IS NOT NULL AND rented_at IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL) OR (status IN ('ACTIVE','OVERDUE','RETURNED') AND rented_at IS NOT NULL AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL) OR (status = 'CANCELLED' AND booked_at IS NOT NULL AND rented_at IS NULL AND cancelled_at IS NOT NULL AND cancelled_at >= booked_at AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0)",
)
@Index('idx_rentals_booking_expiry', { synchronize: false })
@Index('idx_rentals_due', { synchronize: false })
// The migration preserves (renter_id, rented_at DESC, rental_id DESC).
@Index('idx_rentals_renter_history', { synchronize: false })
export class Rental {
  @PrimaryGeneratedColumn('uuid', { name: 'rental_id', primaryKeyConstraintName: 'rentals_pkey' })
  rentalId: string;

  @Column({ name: 'renter_id', type: 'uuid' })
  renterId: string;

  // ACTIVE remains the default only for the legacy immediate-checkout path.
  @Column({ type: 'text', default: 'ACTIVE' })
  status: RentalStatus;

  // Legacy rentals have no known booking timestamp; do not invent one on migration.
  @Column({ name: 'booked_at', type: 'timestamptz', nullable: true })
  bookedAt: Date | null;

  @Column({ name: 'booking_expires_at', type: 'timestamptz', nullable: true })
  bookingExpiresAt: Date | null;

  @Column({ name: 'rented_at', type: 'timestamptz', nullable: true })
  rentedAt: Date | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancelled_by', type: 'text', nullable: true })
  cancelledBy: string | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @ManyToOne(() => Renter, renter => renter.rentals, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'renter_id',
    referencedColumnName: 'renterId',
    foreignKeyConstraintName: 'rentals_renter_id_fkey',
  })
  renter: Relation<Renter>;

  @OneToMany(() => RentalItem, item => item.rental)
  items: Relation<RentalItem[]>;
}
