import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { GameCondition, PhysicalFormat } from './enums';
import { Game } from './game.entity';
import { Platform } from './platform.entity';
import { RentalItem } from './rental-item.entity';

@Entity('game_copies')
@Check('game_copies_price_per_day_check', '"price_per_day" >= 0')
export class GameCopy {
  @PrimaryGeneratedColumn('uuid', {
    name: 'game_copy_id',
    primaryKeyConstraintName: 'game_copies_pkey',
  })
  gameCopyId: string;

  @Column({ name: 'game_id', type: 'uuid' })
  gameId: string;

  @Column({ name: 'platform_id', type: 'uuid' })
  platformId: string;

  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl: string | null;

  @Column({ type: 'enum', enum: GameCondition, enumName: 'game_condition' })
  condition: GameCondition;

  @Column({ type: 'enum', enum: PhysicalFormat, enumName: 'physical_format' })
  format: PhysicalFormat;

  // Current price, in kopecks. RentalItem stores its own historical snapshot.
  @Column({ name: 'price_per_day', type: 'integer' })
  pricePerDayKopecks: number;

  @ManyToOne(() => Game, game => game.copies, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'game_id',
    referencedColumnName: 'gameId',
    foreignKeyConstraintName: 'game_copies_game_id_fkey',
  })
  game: Relation<Game>;

  @ManyToOne(() => Platform, platform => platform.copies, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'platform_id',
    referencedColumnName: 'platformId',
    foreignKeyConstraintName: 'game_copies_platform_id_fkey',
  })
  platform: Relation<Platform>;

  @OneToMany(() => RentalItem, item => item.gameCopy)
  rentalItems: Relation<RentalItem[]>;
}
