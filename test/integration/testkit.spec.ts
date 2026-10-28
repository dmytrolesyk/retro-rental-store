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
    const db = kit.dataSource;
    const [server] = await db.query<{ version: number }[]>(
      "SELECT current_setting('server_version_num')::int AS version",
    );
    expect(server.version).toBeGreaterThanOrEqual(160000);
    expect(server.version).toBeLessThan(170000);
    await expect(db.showMigrations()).resolves.toBe(false);
    await expect(db.getRepository(RentalJob).count()).resolves.toBe(0);
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
    const db = kit.dataSource;
    const catalog = aCatalog({ pricePerDay: 3500 });
    await db.getRepository(Game).save(catalog.game);
    await db.getRepository(Platform).save(catalog.platform);
    await db.getRepository(GamePlatform).save(catalog.gamePlatform);
    await db.getRepository(GameCopy).save(catalog.copy);
    await db.getRepository(Renter).save(aRenter());

    await expect(
      db.getRepository(GameCopy).findOneByOrFail({ gameCopyId: catalog.copy.gameCopyId }),
    ).resolves.toMatchObject(catalog.copy);

    await kit.reset();
    for (const table of ['renters', 'game_copies', 'game_platforms', 'games', 'platforms']) {
      await expect(db.getRepository(table).count()).resolves.toBe(0);
    }
    await expect(db.showMigrations()).resolves.toBe(false);
  });
});
