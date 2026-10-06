import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource, In } from 'typeorm';
import { createDataSourceOptions } from '../database/data-source-options';
import { Game, GameCopy, Rental, RentalItem } from '../database/entities';
import { QueryCountLogger } from '../database/query-count.logger';

const logger = new QueryCountLogger();
const dataSource = new DataSource({
  ...createDataSourceOptions(),
  logging: ['query'],
  logger,
});

async function loadNaively(rentalIds: string[]): Promise<Rental[]> {
  const rentals = await dataSource.getRepository(Rental).find({
    where: { rentalId: In(rentalIds) },
    order: { rentedAt: 'DESC', rentalId: 'DESC' },
  });

  for (const rental of rentals) {
    rental.items = await dataSource.getRepository(RentalItem).find({
      where: { rentalId: rental.rentalId },
    });
    for (const item of rental.items) {
      item.gameCopy = await dataSource.getRepository(GameCopy).findOneByOrFail({
        gameCopyId: item.gameCopyId,
      });
      item.gameCopy.game = await dataSource.getRepository(Game).findOneByOrFail({
        gameId: item.gameCopy.gameId,
      });
    }
  }
  return rentals;
}

function rentalHistoryQuery(rentalIds: string[]) {
  return dataSource
    .getRepository(Rental)
    .createQueryBuilder('rental')
    .leftJoinAndSelect('rental.items', 'item')
    .leftJoinAndSelect('item.gameCopy', 'copy')
    .leftJoinAndSelect('copy.game', 'game')
    .where('rental.rentalId IN (:...rentalIds)', { rentalIds })
    .orderBy('rental.rentedAt', 'DESC')
    .addOrderBy('rental.rentalId', 'DESC');
}

async function measure(label: string, load: () => Promise<Rental[]>) {
  console.log(`\n${label}`);
  logger.reset();
  logger.echo = true;
  try {
    const rentals = await load();
    return { rentals, count: logger.count };
  } finally {
    logger.echo = false;
  }
}

// JOIN results and separate SELECTs need not return positions in the same order.
// Compare the entire loaded graph, including dates and historical/current prices.
function normalize(rentals: Rental[]) {
  for (const rental of rentals) {
    rental.items.sort((a, b) => a.gameCopyId.localeCompare(b.gameCopyId));
  }
  return rentals.toSorted((a, b) => a.rentalId.localeCompare(b.rentalId));
}

async function demo(): Promise<void> {
  try {
    await dataSource.initialize();
    // Setup queries are outside the measurement; both loaders receive identical IDs.
    const latestRentals = await dataSource.getRepository(Rental).find({
      select: { rentalId: true },
      order: { rentedAt: 'DESC', rentalId: 'DESC' },
      take: 10,
    });
    assert.equal(latestRentals.length, 10, 'Need at least 10 rentals. Run pnpm run seed first.');
    const allRentalIds = latestRentals.map(rental => rental.rentalId);
    const results: { N: number; before: number; after: number; afterWithPagination: number }[] = [];

    for (const N of [5, 10]) {
      const rentalIds = allRentalIds.slice(0, N);
      const naive = await measure(`N=${String(N)} — наївно: SELECT у циклах`, () =>
        loadNaively(rentalIds),
      );
      const joined = await measure(`N=${String(N)} — виправлення: LEFT JOIN`, () =>
        rentalHistoryQuery(rentalIds).getMany(),
      );
      const paginated = await measure(`N=${String(N)} — LEFT JOIN із take(${String(N)})`, () =>
        rentalHistoryQuery(allRentalIds).take(N).getMany(),
      );

      assert.equal(naive.rentals.length, N);
      assert.deepEqual(
        naive.rentals.map(rental => rental.rentalId),
        rentalIds,
      );
      assert.deepEqual(normalize(joined.rentals), normalize(naive.rentals));
      assert.deepEqual(normalize(paginated.rentals), normalize(naive.rentals));
      for (const rental of naive.rentals) {
        assert.ok(rental.items.length > 0, 'Demo requires rentals with items. Run the seed first.');
        for (const item of rental.items) {
          assert.equal(item.gameCopy.gameCopyId, item.gameCopyId);
          assert.equal(item.gameCopy.game.gameId, item.gameCopy.gameId);
        }
      }
      assert.ok(naive.count >= N);
      // Three relation levels: rental → items → copy → game.
      assert.ok(joined.count > 0 && joined.count <= 1 + 2 * 3);
      assert.ok(paginated.count > 0 && paginated.count <= 1 + 2 * 3);

      const itemCount = naive.rentals.reduce((sum, rental) => sum + rental.items.length, 0);
      console.log(
        `\nN=${String(N)}: before=${String(naive.count)}, after=${String(joined.count)}, ` +
          `afterWithPagination=${String(paginated.count)}; results match (${String(itemCount)} items)`,
      );
      results.push({
        N,
        before: naive.count,
        after: joined.count,
        afterWithPagination: paginated.count,
      });
    }

    assert.ok(results[1].before > results[0].before, 'Naive query count must grow with N.');
    assert.equal(results[1].after, results[0].after, 'JOIN count must stay constant.');
    assert.equal(
      results[1].afterWithPagination,
      results[0].afterWithPagination,
      'Paginated count must stay constant.',
    );
    console.log('\nПідсумок:');
    console.table(results);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

demo().catch((error: unknown) => {
  console.error('N+1 demo failed:', error);
  process.exitCode = 1;
});
