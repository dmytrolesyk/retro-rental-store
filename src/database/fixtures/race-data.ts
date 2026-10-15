import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  Game,
  GameCopy,
  GamePlatform,
  Platform,
  Renter,
  GameCondition,
  PhysicalFormat,
} from '../entities';

export const raceSettings = { attempts: 50, copies: 10, price: 2500, balance: 100000 } as const;

// Add a fresh fixture per run. Never reset balances or delete existing rentals.
export async function createRaceData(manager: EntityManager) {
  const gameId = randomUUID();
  const platformId = randomUUID();
  await manager.insert(Game, {
    gameId,
    name: `Race demo ${gameId}`,
    nameUk: 'Демо конкурентної оренди',
    description: 'Isolated fixture for fifty concurrent checkout attempts.',
    descriptionUk: 'Окремі демодані для 50 конкурентних спроб оренди.',
  });
  await manager.insert(Platform, {
    platformId,
    name: `Race platform ${platformId}`,
    description: 'Race demo platform',
    descriptionUk: 'Платформа демо',
    releaseDate: '2000-01-01',
  });
  await manager.insert(GamePlatform, { gameId, platformId });
  const copies = Array.from({ length: raceSettings.copies }, () => ({
    gameCopyId: randomUUID(),
    gameId,
    platformId,
    condition: GameCondition.Good,
    format: PhysicalFormat.Cartridge,
    pricePerDay: raceSettings.price,
  }));
  await manager.insert(GameCopy, copies);
  const renters = Array.from({ length: raceSettings.attempts }, (_, index) => {
    const renterId = randomUUID();
    return {
      renterId,
      name: `Race renter ${String(index + 1)}`,
      email: `${renterId}@example.test`,
      phoneNumber: renterId,
      balance: raceSettings.balance,
    };
  });
  await manager.insert(Renter, renters);
  return { gameId, platformId, renters };
}
