import { GameCondition } from '../entities';
import type { readRetronianCatalog } from './retronian-catalog';

// The order is fixed: copy IDs, dates and prices never depend on query order or time.
const selectedGames = [
  // Super Mario Bros. — Game Boy Advance
  ['7ba16913-c41b-56fc-b2c7-319886fc236c', '73f410b7-e638-5d57-9a94-7d60bcbe2596'],
  // Sonic the Hedgehog — Sega Mega Drive
  ['cad601e0-1a0e-5c54-a5d6-9188686b9ca3', '8c84de17-b2b8-50fb-8e08-6bfb007f15e3'],
  // Tetris — Game Boy
  ['76e907f0-a619-5c25-b65b-905710c7f6d1', '0f8bb4f5-6df3-57ba-bbce-edb035594859'],
  // Crash Bandicoot — PlayStation
  ['bb9a6787-a9ff-5020-87b3-5252d0a8e8e3', '575c8b6c-0689-5510-9054-ba29c1d56331'],
  // Donkey Kong Country — Super Nintendo Entertainment System
  ['cc2b80a7-1bc7-5d14-87aa-3807deb63b3e', 'cb782f9a-c28c-5c6f-8319-162458467522'],
  // Final Fantasy VII — PlayStation Portable
  ['6006e4e7-a13a-5e0f-9d82-460923d1c107', '11a05b75-02d2-5679-8ef9-9aba07e198db'],
  // Street Fighter II — Super Nintendo Entertainment System
  ['d25736f9-9fce-578f-8110-db90e88bdc67', 'cb782f9a-c28c-5c6f-8319-162458467522'],
  // Mega Man 2 — Nintendo Entertainment System
  ['aefc0fab-d679-558e-9988-7beb56cb7e54', '9feeda13-707b-58ca-8280-f9bc0a80a62e'],
  // Metroid — Nintendo Entertainment System
  ['bc37ce31-993c-5e9e-a89e-878c2365d60e', '9feeda13-707b-58ca-8280-f9bc0a80a62e'],
  // Chrono Trigger — Nintendo DS
  ['3a744f43-af3b-5a28-bff2-c5ba1ed56033', 'f1d19ee3-4646-5366-a782-f3b51cf8eb1d'],
] as const;

function homeworkId(namespace: '10000000' | '20000000' | '30000000', index: number): string {
  return `${namespace}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

export function createHomeworkData(catalog: ReturnType<typeof readRetronianCatalog>) {
  const gameCopies = selectedGames.map(([gameId, platformId], index) => {
    if (
      !catalog.gamePlatforms.some(row => row.gameId === gameId && row.platformId === platformId)
    ) {
      throw new Error(
        `Homework game/platform pair is missing from the catalog: ${gameId}/${platformId}`,
      );
    }
    const platformFormat = catalog.platformFormats.find(row => row.platformId === platformId);
    if (!platformFormat) throw new Error(`Missing physical format for platform ${platformId}`);

    return {
      gameCopyId: homeworkId('10000000', index),
      gameId,
      platformId,
      photoUrl: null,
      condition: index % 2 === 0 ? GameCondition.AsNew : GameCondition.Good,
      format: platformFormat.format,
      pricePerDayKopecks: 2500 + index * 250,
    };
  });

  const names = [
    'Олена',
    'Богдан',
    'Катерина',
    'Дмитро',
    'Марія',
    'Андрій',
    'Софія',
    'Тарас',
    'Ірина',
    'Назар',
  ];
  const renters = names.map((name, index) => ({
    renterId: homeworkId('20000000', index),
    name,
    email: `renter${String(index + 1)}@example.test`,
    phoneNumber: `+380000000${String(index + 1).padStart(3, '0')}`,
  }));

  const rentals = renters.map((renter, index) => ({
    rentalId: homeworkId('30000000', index),
    renterId: renter.renterId,
    rentedAt: new Date(Date.UTC(2026, 8, 1 + index * 3, 10)),
  }));

  // Two positions per rental. Returned copies can be rented again.
  // Only the last rental is active, so its two copies never conflict.
  const rentalItems = rentals.flatMap((rental, index) =>
    [index, (index + 1) % gameCopies.length].map(copyIndex => ({
      rentalId: rental.rentalId,
      gameCopyId: gameCopies[copyIndex].gameCopyId,
      returnedAt:
        index === rentals.length - 1 ? null : new Date(Date.UTC(2026, 8, 2 + index * 3, 10)),
      costPerDayKopecks: 2000 + copyIndex * 250,
    })),
  );

  return { gameCopies, renters, rentals, rentalItems };
}
