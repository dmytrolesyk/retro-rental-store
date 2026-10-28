import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { RentalReceipt } from '../rentals.types';

@Entity('rental_requests')
export class RentalRequest {
  @PrimaryColumn({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;
  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;
  @Column({ type: 'jsonb', nullable: true })
  response: RentalReceipt | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
