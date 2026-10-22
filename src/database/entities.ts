// Entity registration for TypeORM CLI and shared DataSource setup.
import { Game } from '../catalog/entities/game.entity';
import { Platform } from '../catalog/entities/platform.entity';
import { GamePlatform } from '../catalog/entities/game-platform.entity';
import { GameCopy } from '../catalog/entities/game-copy.entity';
import { Genre } from '../catalog/entities/genre.entity';
import { GameGenre } from '../catalog/entities/game-genre.entity';
import { Renter } from '../renters/entities/renter.entity';
import { Rental } from '../rentals/entities/rental.entity';
import { RentalItem } from '../rentals/entities/rental-item.entity';
import { RentalJob } from '../jobs/entities/rental-job.entity';

export {
  Game,
  Platform,
  GamePlatform,
  GameCopy,
  Genre,
  GameGenre,
  Renter,
  Rental,
  RentalItem,
  RentalJob,
};
export { GameCondition, PhysicalFormat, GameDataSource } from '../catalog/entities/enums';

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
  RentalJob,
];
