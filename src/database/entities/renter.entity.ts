import { Column, Entity, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { Relation } from 'typeorm';
import { Rental } from './rental.entity';

@Entity('renters')
@Unique('renters_email_key', ['email'])
@Unique('renters_phone_number_key', ['phoneNumber'])
export class Renter {
  @PrimaryGeneratedColumn('uuid', { name: 'renter_id', primaryKeyConstraintName: 'renters_pkey' })
  renterId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 120 })
  email: string;

  @Column({ name: 'phone_number', type: 'varchar' })
  phoneNumber: string;

  @OneToMany(() => Rental, rental => rental.renter)
  rentals: Relation<Rental[]>;
}
