import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { GameDataSource } from './enums';
import { GameCopy } from './game-copy.entity';
import { GameGenre } from './game-genre.entity';
import { GamePlatform } from './game-platform.entity';

@Entity('games')
// PostgreSQL expression and GIN indexes are created explicitly in the migration.
@Index('idx_games_lower_name_uk', { synchronize: false })
@Index('idx_games_search_vector', { synchronize: false })
export class Game {
  @PrimaryGeneratedColumn('uuid', { name: 'game_id', primaryKeyConstraintName: 'games_pkey' })
  gameId: string;

  @Column({ name: 'game_cover_url', type: 'text', nullable: true })
  gameCoverUrl: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'name_uk', type: 'text' })
  nameUk: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'description_uk', type: 'text' })
  descriptionUk: string;

  @Column({ name: 'release_date', type: 'date', nullable: true })
  releaseDate: string | null;

  @Column({
    name: 'data_source',
    type: 'enum',
    enum: GameDataSource,
    enumName: 'game_data_source',
    default: GameDataSource.Manual,
  })
  dataSource: GameDataSource;

  @Column({
    name: 'search_vector',
    type: 'tsvector',
    asExpression:
      "setweight(to_tsvector('simple', name_uk), 'A') || setweight(to_tsvector('simple', description_uk), 'B')",
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
  })
  searchVector: string;

  @OneToMany(() => GameCopy, copy => copy.game)
  copies: Relation<GameCopy[]>;

  @OneToMany(() => GamePlatform, gamePlatform => gamePlatform.game)
  gamePlatforms: Relation<GamePlatform[]>;

  @OneToMany(() => GameGenre, gameGenre => gameGenre.game)
  gameGenres: Relation<GameGenre[]>;
}
