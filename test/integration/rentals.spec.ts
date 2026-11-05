import { randomUUID } from 'node:crypto';
import {
  Game,
  GameCopy,
  GamePlatform,
  Platform,
  Rental,
  RentalItem,
  Renter,
} from '../../src/database/entities';
import { aCatalog, aRental, aRentalItem, aRenter } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';

describe('Rental repository (PostgreSQL)', () => {
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

  it('saves and reads a rental for an existing renter', async () => {
    const dataSource = kit.dataSource;
    const renter = await dataSource.getRepository(Renter).save(aRenter());
    const rental = aRental(renter.renterId);
    const expected = { ...rental };
    await dataSource.getRepository(Rental).save(rental);

    await expect(
      dataSource.getRepository(Rental).findOneByOrFail({ rentalId: rental.rentalId }),
    ).resolves.toMatchObject(expected);
    await expect(dataSource.getRepository(Rental).count()).resolves.toBe(1);
  });

  it('rejects a nonexistent renter with foreign key violation 23503 without creating a rental', async () => {
    const rentals = kit.dataSource.getRepository(Rental);

    await expect(rentals.save(aRental(randomUUID()))).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'rentals_renter_id_fkey' },
    });
    await expect(rentals.count()).resolves.toBe(0);
  });

  it('JOINs the requested rental with its renter and exactly its own items', async () => {
    const dataSource = kit.dataSource;
    const renters = dataSource.getRepository(Renter);
    const rentals = dataSource.getRepository(Rental);
    const renter = await renters.save(aRenter({ name: 'Марія' }));
    const otherRenter = await renters.save(aRenter({ name: 'Андрій' }));
    const rental = await rentals.save(aRental(renter.renterId));
    const otherRental = await rentals.save(aRental(otherRenter.renterId));
    const first = aCatalog({ pricePerDay: 2500 });
    const second = aCatalog({ pricePerDay: 4000 });
    const unrelated = aCatalog({ pricePerDay: 9000 });

    for (const catalog of [first, second, unrelated]) {
      await dataSource.getRepository(Game).save(catalog.game);
      await dataSource.getRepository(Platform).save(catalog.platform);
      await dataSource.getRepository(GamePlatform).save(catalog.gamePlatform);
      await dataSource.getRepository(GameCopy).save(catalog.copy);
    }
    const items = [
      aRentalItem(rental.rentalId, first.copy.gameCopyId),
      aRentalItem(rental.rentalId, second.copy.gameCopyId, {
        costPerDay: 4000,
        returnedAt: new Date(rental.rentedAt.getTime() + 86400000),
      }),
    ];
    const expectedItems = items.map(item => ({ ...item }));
    await dataSource.getRepository(RentalItem).save([
      ...items,
      aRentalItem(otherRental.rentalId, unrelated.copy.gameCopyId, {
        costPerDay: 9000,
      }),
    ]);

    const results = await rentals
      .createQueryBuilder('rental')
      .innerJoinAndSelect('rental.renter', 'renter')
      .innerJoinAndSelect('rental.items', 'item')
      .where('rental.rentalId = :rentalId', { rentalId: rental.rentalId })
      .getMany();

    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result.rentalId).toBe(rental.rentalId);
    expect(result.renter).toMatchObject(renter);
    expect(result.items).toHaveLength(2);
    for (const item of expectedItems) {
      expect(result.items).toContainEqual(expect.objectContaining(item));
    }
  });
});
