import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { GameCopy } from './game-copy.entity';
import { Rental } from './rental.entity';

@Entity('rental_items')
@Check('rental_items_cost_per_day_check', '"cost_per_day" >= 0')
@Index('one_active_rental_per_copy', ['gameCopyId'], {
  unique: true,
  where: '"returned_at" IS NULL',
})
export class RentalItem {
  @PrimaryColumn({ name: 'rental_id', type: 'uuid', primaryKeyConstraintName: 'rental_items_pkey' })
  rentalId: string;

  @PrimaryColumn({
    name: 'game_copy_id',
    type: 'uuid',
    primaryKeyConstraintName: 'rental_items_pkey',
  })
  gameCopyId: string;

  @Column({ name: 'returned_at', type: 'timestamptz', nullable: true })
  returnedAt: Date | null;

  // Snapshot in kopecks: changing the copy's current price must not rewrite history.
  @Column({ name: 'cost_per_day', type: 'integer' })
  costPerDayKopecks: number;

  @ManyToOne(() => Rental, rental => rental.items, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'rental_id',
    referencedColumnName: 'rentalId',
    foreignKeyConstraintName: 'rental_items_rental_id_fkey',
  })
  rental: Relation<Rental>;

  @ManyToOne(() => GameCopy, copy => copy.rentalItems, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'game_copy_id',
    referencedColumnName: 'gameCopyId',
    foreignKeyConstraintName: 'rental_items_game_copy_id_fkey',
  })
  gameCopy: Relation<GameCopy>;
}
