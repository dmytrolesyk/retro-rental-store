import { Column, Entity, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { Relation } from 'typeorm';
import { GameCopy } from './game-copy.entity';
import { GamePlatform } from './game-platform.entity';

@Entity('platforms')
@Unique('platforms_name_key', ['name'])
export class Platform {
  @PrimaryGeneratedColumn('uuid', {
    name: 'platform_id',
    primaryKeyConstraintName: 'platforms_pkey',
  })
  platformId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'description_uk', type: 'text' })
  descriptionUk: string;

  @Column({ name: 'release_date', type: 'date' })
  releaseDate: string;

  @OneToMany(() => GameCopy, copy => copy.platform)
  copies: Relation<GameCopy[]>;

  @OneToMany(() => GamePlatform, gamePlatform => gamePlatform.platform)
  gamePlatforms: Relation<GamePlatform[]>;
}
