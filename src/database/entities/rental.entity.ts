import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Renter } from './renter.entity';
import { RentalItem } from './rental-item.entity';

@Entity('rentals')
// The migration preserves (renter_id, rented_at DESC, rental_id DESC).
@Index('idx_rentals_renter_history', { synchronize: false })
export class Rental {
  @PrimaryGeneratedColumn('uuid', { name: 'rental_id', primaryKeyConstraintName: 'rentals_pkey' })
  rentalId: string;

  @Column({ name: 'renter_id', type: 'uuid' })
  renterId: string;

  @Column({ name: 'rented_at', type: 'timestamptz' })
  rentedAt: Date;

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
