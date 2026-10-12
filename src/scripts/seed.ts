import dataSource from '../data-source';
import { createHomeworkData } from '../database/fixtures/homework-data';
import { readRetronianCatalog } from '../database/fixtures/retronian-catalog';
import {
  Game,
  GameCopy,
  GameGenre,
  GamePlatform,
  Genre,
  Platform,
  Rental,
  RentalItem,
  Renter,
} from '../database/entities';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

const batchSize = 500;

async function insertMissing<T extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<T>,
  rows: QueryDeepPartialEntity<T>[],
): Promise<void> {
  const metadata = manager.connection.getMetadata(entity);
  // Target only this entity's primary key. Other UNIQUE conflicts are errors,
  // not silently skipped rows (which could leave our related data incomplete).
  const conflictColumns = metadata.primaryColumns
    .map(column => manager.connection.driver.escape(column.databaseName))
    .join(', ');

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(entity)
      .values(rows.slice(offset, offset + batchSize))
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- TypeORM 0.3 orIgnore cannot target just the PK.
      .onConflict(`(${conflictColumns}) DO NOTHING`)
      .execute();
  }
  console.log(`${metadata.tableName}: processed ${String(rows.length)} fixture rows`);
}

async function seed(): Promise<void> {
  // Parse and validate files before acquiring a connection or changing any data.
  const catalog = readRetronianCatalog();
  const homework = createHomeworkData(catalog);

  try {
    await dataSource.initialize();
    await dataSource.transaction(async manager => {
      await insertMissing(manager, Platform, catalog.platforms);
      await insertMissing(manager, Genre, catalog.genres);
      await insertMissing(manager, Game, catalog.games);
      await insertMissing(manager, GamePlatform, catalog.gamePlatforms);
      await insertMissing(manager, GameGenre, catalog.gameGenres);
      await insertMissing(manager, GameCopy, homework.gameCopies);
      await insertMissing(manager, Renter, homework.renters);
      await insertMissing(manager, Rental, homework.rentals);
      await insertMissing(manager, RentalItem, homework.rentalItems);
    });
    console.log('Seed committed. Existing rows were preserved.');
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
