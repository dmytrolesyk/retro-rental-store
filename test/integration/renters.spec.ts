import { Renter } from '../../src/renters/entities/renter.entity';
import { aRenter } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';

describe('Renter repository (PostgreSQL)', () => {
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

  it('saves and reads a renter by ID with the stored balance', async () => {
    const renters = kit.dataSource.getRepository(Renter);
    const renter = aRenter({ name: 'Олена', balance: 12500 });
    await renters.save(renter);

    await expect(renters.findOneByOrFail({ renterId: renter.renterId })).resolves.toMatchObject(
      renter,
    );
    await expect(renters.count()).resolves.toBe(1);
  });

  it('rejects a duplicate email with unique violation 23505 and keeps the original renter', async () => {
    const renters = kit.dataSource.getRepository(Renter);
    const original = aRenter();
    await renters.save(original);

    await expect(renters.save(aRenter({ email: original.email }))).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'renters_email_key' },
    });

    await expect(renters.count()).resolves.toBe(1);
    await expect(renters.findOneByOrFail({ email: original.email })).resolves.toMatchObject(
      original,
    );
  });

  it('allows zero balance but rejects a negative balance with check violation 23514', async () => {
    const renters = kit.dataSource.getRepository(Renter);
    const renter = aRenter({ balance: 2500 });
    await renters.save(renter);
    await renters.update({ renterId: renter.renterId }, { balance: 0 });
    await expect(renters.findOneByOrFail({ renterId: renter.renterId })).resolves.toMatchObject({
      balance: 0,
    });

    await expect(
      renters.update({ renterId: renter.renterId }, { balance: -1 }),
    ).rejects.toMatchObject({
      driverError: { code: '23514', constraint: 'renters_balance_check' },
    });
    await expect(renters.findOneByOrFail({ renterId: renter.renterId })).resolves.toMatchObject({
      balance: 0,
    });
  });
});
