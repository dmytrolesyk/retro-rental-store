import { randomUUID } from 'node:crypto';
import type { Renter } from '../../../src/renters/entities/renter.entity';
import type { Rental } from '../../../src/rentals/entities/rental.entity';
import type { RentalItem } from '../../../src/rentals/entities/rental-item.entity';
import { GameCondition, GameDataSource, PhysicalFormat } from '../../../src/catalog/entities/enums';

type RenterData = Pick<Renter, 'renterId' | 'name' | 'email' | 'phoneNumber' | 'balance'>;
let phoneSequence = 0;

/** Every call produces an independent renter, with valid unique defaults. */
export function aRenter(overrides: Partial<RenterData> = {}): RenterData {
  const renterId = randomUUID();
  return {
    renterId,
    name: 'Тестовий орендар',
    email: `renter-${renterId}@example.test`,
    phoneNumber: `+38067${String(++phoneSequence).padStart(7, '0')}`,
    balance: 10000,
    ...overrides,
  };
}

type RentalData = Pick<Rental, 'rentalId' | 'renterId' | 'rentedAt'>;

export function aRental(renterId: string, overrides: Partial<RentalData> = {}): RentalData {
  return {
    rentalId: randomUUID(),
    renterId,
    rentedAt: new Date('2020-01-01T12:00:00.000Z'),
    ...overrides,
  };
}

type RentalItemData = Pick<RentalItem, 'rentalId' | 'gameCopyId' | 'costPerDay' | 'returnedAt'>;

export function aRentalItem(
  rentalId: string,
  gameCopyId: string,
  overrides: Partial<Pick<RentalItemData, 'costPerDay' | 'returnedAt'>> = {},
): RentalItemData {
  return { rentalId, gameCopyId, costPerDay: 2500, returnedAt: null, ...overrides };
}

/** Minimal linked catalog for a checkout; pure data, with no database side effects. */
export function aCatalog({ pricePerDay = 2500 }: { pricePerDay?: number } = {}) {
  const gameId = randomUUID();
  const platformId = randomUUID();
  return {
    game: {
      gameId,
      name: `Test game ${gameId}`,
      nameUk: 'Тестова гра',
      description: '',
      descriptionUk: '',
      gameCoverUrl: null,
      releaseDate: '1990-01-01',
      dataSource: GameDataSource.Manual,
    },
    platform: {
      platformId,
      name: `Test platform ${platformId}`,
      description: '',
      descriptionUk: '',
      releaseDate: '1990-01-01',
    },
    gamePlatform: { gameId, platformId },
    copy: {
      gameCopyId: randomUUID(),
      gameId,
      platformId,
      photoUrl: null,
      condition: GameCondition.Good,
      format: PhysicalFormat.Cartridge,
      pricePerDay,
    },
  };
}
