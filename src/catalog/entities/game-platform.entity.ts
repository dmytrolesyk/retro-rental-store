import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Game } from './game.entity';
import { Platform } from './platform.entity';

@Entity('game_platforms')
export class GamePlatform {
  @PrimaryColumn({ name: 'game_id', type: 'uuid', primaryKeyConstraintName: 'game_platforms_pkey' })
  gameId: string;

  @PrimaryColumn({
    name: 'platform_id',
    type: 'uuid',
    primaryKeyConstraintName: 'game_platforms_pkey',
  })
  platformId: string;

  @ManyToOne(() => Game, game => game.gamePlatforms, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'game_id',
    referencedColumnName: 'gameId',
    foreignKeyConstraintName: 'game_platforms_game_id_fkey',
  })
  game: Relation<Game>;

  @ManyToOne(() => Platform, platform => platform.gamePlatforms, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'platform_id',
    referencedColumnName: 'platformId',
    foreignKeyConstraintName: 'game_platforms_platform_id_fkey',
  })
  platform: Relation<Platform>;
}
