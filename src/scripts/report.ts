import dataSource from '../data-source';
import { Platform } from '../database/entities';

interface PlatformPopularityRow {
  platformId: string;
  platformName: string;
  // PostgreSQL COUNT returns bigint; pg preserves it as a string.
  rentalItemCount: string;
  rentalCount: string;
}

async function report(): Promise<void> {
  try {
    await dataSource.initialize();
    const rows = await dataSource
      .getRepository(Platform)
      .createQueryBuilder('platform')
      .leftJoin('platform.copies', 'copy')
      .leftJoin('copy.rentalItems', 'item')
      .select('platform.platformId', 'platformId')
      .addSelect('platform.name', 'platformName')
      // COUNT(*) would incorrectly count a LEFT JOIN placeholder as one rental item.
      .addSelect('COUNT(item.rentalId)', 'rentalItemCount')
      .addSelect('COUNT(DISTINCT item.rentalId)', 'rentalCount')
      .groupBy('platform.platformId')
      .addGroupBy('platform.name')
      .orderBy('"rentalItemCount"', 'DESC')
      .addOrderBy('platform.name', 'ASC')
      .addOrderBy('platform.platformId', 'ASC')
      .getRawMany<PlatformPopularityRow>();

    console.log('Популярність платформ за весь час (включно з активними орендами):');
    console.table(
      rows.map(row => ({
        platform: row.platformName,
        rentalItems: row.rentalItemCount,
        rentals: row.rentalCount,
      })),
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

report().catch((error: unknown) => {
  console.error('Report failed:', error);
  process.exitCode = 1;
});
