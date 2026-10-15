import { Check, Column, Entity, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { Relation } from 'typeorm';
import { Rental } from './rental.entity';

@Entity('renters')
@Unique('renters_email_key', ['email'])
@Unique('renters_phone_number_key', ['phoneNumber'])
@Check('renters_balance_check', '"balance" >= 0')
export class Renter {
  @PrimaryGeneratedColumn('uuid', { name: 'renter_id', primaryKeyConstraintName: 'renters_pkey' })
  renterId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 120 })
  email: string;

  @Column({ name: 'phone_number', type: 'varchar' })
  phoneNumber: string;

  // Internal balance in kopecks, matching the integer price snapshots on rental items.
  @Column({ name: 'balance', type: 'integer', default: 0 })
  balanceKopecks: number;

  @OneToMany(() => Rental, rental => rental.renter)
  rentals: Relation<Rental[]>;
}
