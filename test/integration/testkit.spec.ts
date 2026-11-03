import {
  Game,
  GameCopy,
  GamePlatform,
  Platform,
  RentalJob,
  Renter,
} from '../../src/database/entities';
import { aCatalog, aRenter } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';

describe('PostgreSQL testkit', () => {
  let kit: PostgresTestkit;
  let stopPostgres: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    kit = await startPostgres();
    stopPostgres = () => kit.stop();
  });

  beforeEach(async () => {
    await kit.reset();
  });

  afterAll(async () => {
    await stopPostgres?.();
  });

  it('applies the real migrations on PostgreSQL 16', async () => {
    const dataSource = kit.dataSource;
    const [server] = await dataSource.query<{ version: number }[]>(
      "SELECT current_setting('server_version_num')::int AS version",
    );
    expect(server.version).toBeGreaterThanOrEqual(160000);
    expect(server.version).toBeLessThan(170000);
    await expect(dataSource.showMigrations()).resolves.toBe(false);
    await expect(dataSource.getRepository(RentalJob).count()).resolves.toBe(0);
  });

  it('persists renter builders with unique defaults and explicit overrides', async () => {
    const renters = kit.dataSource.getRepository(Renter);
    const first = aRenter({ name: 'Тестовий орендар', balance: 10000 });
    const second = aRenter();
    expect(first.email).not.toBe(second.email);
    expect(first.phoneNumber).not.toBe(second.phoneNumber);
    await renters.save([first, second]);

    await expect(renters.findOneByOrFail({ renterId: first.renterId })).resolves.toMatchObject(
      first,
    );
    await expect(renters.count()).resolves.toBe(2);
  });

  it('persists a valid catalog and resets data without losing the migrated schema', async () => {
    const dataSource = kit.dataSource;
    const catalog = aCatalog({ pricePerDay: 3500 });
    await dataSource.getRepository(Game).save(catalog.game);
    await dataSource.getRepository(Platform).save(catalog.platform);
    await dataSource.getRepository(GamePlatform).save(catalog.gamePlatform);
    await dataSource.getRepository(GameCopy).save(catalog.copy);
    await dataSource.getRepository(Renter).save(aRenter());

    await expect(
      dataSource.getRepository(GameCopy).findOneByOrFail({ gameCopyId: catalog.copy.gameCopyId }),
    ).resolves.toMatchObject(catalog.copy);

    await kit.reset();
    for (const table of ['renters', 'game_copies', 'game_platforms', 'games', 'platforms']) {
      await expect(dataSource.getRepository(table).count()).resolves.toBe(0);
    }
    await expect(dataSource.showMigrations()).resolves.toBe(false);
  });
});
