import { Column, Entity, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { Relation } from 'typeorm';
import { GameGenre } from './game-genre.entity';

@Entity('genres')
@Unique('genres_name_key', ['name'])
export class Genre {
  @PrimaryGeneratedColumn('uuid', { name: 'genre_id', primaryKeyConstraintName: 'genres_pkey' })
  genreId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @OneToMany(() => GameGenre, gameGenre => gameGenre.genre)
  gameGenres: Relation<GameGenre[]>;
}
