import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Game } from './game.entity';
import { Genre } from './genre.entity';

@Entity('game_genres')
export class GameGenre {
  @PrimaryColumn({ name: 'game_id', type: 'uuid', primaryKeyConstraintName: 'game_genres_pkey' })
  gameId: string;

  @PrimaryColumn({ name: 'genre_id', type: 'uuid', primaryKeyConstraintName: 'game_genres_pkey' })
  genreId: string;

  @ManyToOne(() => Game, game => game.gameGenres, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'game_id',
    referencedColumnName: 'gameId',
    foreignKeyConstraintName: 'game_genres_game_id_fkey',
  })
  game: Relation<Game>;

  @ManyToOne(() => Genre, genre => genre.gameGenres, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'genre_id',
    referencedColumnName: 'genreId',
    foreignKeyConstraintName: 'game_genres_genre_id_fkey',
  })
  genre: Relation<Genre>;
}
