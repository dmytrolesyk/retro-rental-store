import { Game } from './game.entity';
import { Platform } from './platform.entity';
import { GamePlatform } from './game-platform.entity';
import { GameCopy } from './game-copy.entity';
import { Genre } from './genre.entity';
import { GameGenre } from './game-genre.entity';
import { Renter } from './renter.entity';
import { Rental } from './rental.entity';
import { RentalItem } from './rental-item.entity';

export { Game, Platform, GamePlatform, GameCopy, Genre, GameGenre, Renter, Rental, RentalItem };
export { GameCondition, PhysicalFormat, GameDataSource } from './enums';

export const rentalEntities = [
  Game,
  Platform,
  GamePlatform,
  GameCopy,
  Genre,
  GameGenre,
  Renter,
  Rental,
  RentalItem,
];
