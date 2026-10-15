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
import { Rental } from './rental.entity';

@Entity('rental_jobs')
@Check('rental_jobs_status_check', "\"status\" IN ('new', 'done')")
@Check('rental_jobs_processed_check', '"processed" >= 0')
@Index('idx_rental_jobs_rental', ['rentalId'])
@Index('idx_rental_jobs_new', ['createdAt', 'jobId'], { where: '"status" = \'new\'' })
export class RentalJob {
  @PrimaryGeneratedColumn('uuid', { name: 'job_id', primaryKeyConstraintName: 'rental_jobs_pkey' })
  jobId: string;

  @Column({ name: 'rental_id', type: 'uuid' })
  rentalId: string;

  @Column({ type: 'text', default: 'new' })
  status: 'new' | 'done';

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
