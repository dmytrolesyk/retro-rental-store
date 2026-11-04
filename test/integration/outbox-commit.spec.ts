// Isolate the config boundary here; full-AppModule E2E uses the real ConfigModule.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Rental, RentalOutboxEvent, Renter } from '../../src/database/entities';
import { OutboxCommitSubscriber } from '../../src/outbox/outbox-commit.subscriber';
import { RentalOutboxDispatcher } from '../../src/outbox/rental-outbox.dispatcher';
import { RentalsRepository } from '../../src/rentals/rentals.repository';
import { aRental, aRenter } from './testkit/builders';
import { startPostgres } from './testkit/postgres';
import type { PostgresTestkit } from './testkit/postgres';

describe('postcommit outbox notification (real TypeORM transactions)', () => {
  let kit: PostgresTestkit;
  let stopPostgres: (() => Promise<void>) | undefined;
  let module: TestingModule;
  let rentalsRepository: RentalsRepository;
  const wake = jest.fn<Promise<void>, []>();
  beforeAll(async () => {
    kit = await startPostgres();
    stopPostgres = () => kit.stop();
  });
  beforeEach(async () => {
    await kit.reset();
    wake.mockReset().mockResolvedValue(undefined);
    rentalsRepository = new RentalsRepository(kit.dataSource);
    module = await Test.createTestingModule({
      providers: [
        OutboxCommitSubscriber,
        { provide: DataSource, useValue: kit.dataSource },
        { provide: RentalOutboxDispatcher, useValue: { wake } },
      ],
    }).compile();
    await module.init();
  });
  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
    expect(
      kit.dataSource.subscribers.some(subscriber => subscriber instanceof OutboxCommitSubscriber),
    ).toBe(false);
  });
  afterAll(async () => {
    await stopPostgres?.();
  });
  async function fixture() {
    const renter = await kit.dataSource.getRepository(Renter).save(aRenter());
    return kit.dataSource.getRepository(Rental).save(aRental(renter.renterId));
  }

  it('wakes only after the outer transaction commits and does not await dispatch', async () => {
    const rental = await fixture();
    const writer = kit.dataSource.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    try {
      await rentalsRepository.recordStatusChange(
        writer.manager,
        rental.rentalId,
        'BOOKED',
        rental.rentedAt,
      );
      expect(wake).not.toHaveBeenCalled();
      expect(await kit.dataSource.getRepository(RentalOutboxEvent).count()).toBe(0);
      await writer.commitTransaction();
      expect(wake).toHaveBeenCalledTimes(1);
      expect(await kit.dataSource.getRepository(RentalOutboxEvent).count()).toBe(1);
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
    }
  });

  it('merges nested commits but never wakes for a savepoint release or outer rollback', async () => {
    const rental = await fixture();
    await expect(
      kit.dataSource.transaction(async manager => {
        await manager.transaction(async nestedManager => {
          await rentalsRepository.recordStatusChange(
            nestedManager,
            rental.rentalId,
            'BOOKED',
            rental.rentedAt,
          );
        });
        expect(wake).not.toHaveBeenCalled();
        throw new Error('Outer rollback');
      }),
    ).rejects.toThrow('Outer rollback');
    expect(wake).not.toHaveBeenCalled();
    expect(await kit.dataSource.getRepository(RentalOutboxEvent).count()).toBe(0);
    await kit.dataSource.transaction(manager =>
      manager.transaction(nestedManager =>
        rentalsRepository.recordStatusChange(
          nestedManager,
          rental.rentalId,
          'BOOKED',
          rental.rentedAt,
        ),
      ),
    );
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('discards rolled-back nested changes without dirtying an otherwise clean outer transaction', async () => {
    const rental = await fixture();
    await kit.dataSource.transaction(async manager => {
      await expect(
        manager.transaction(async nestedManager => {
          await rentalsRepository.recordStatusChange(
            nestedManager,
            rental.rentalId,
            'BOOKED',
            rental.rentedAt,
          );
          throw new Error('Savepoint rollback');
        }),
      ).rejects.toThrow('Savepoint rollback');
    });
    expect(wake).not.toHaveBeenCalled();
    expect(await kit.dataSource.getRepository(RentalOutboxEvent).count()).toBe(0);
  });

  it('retains outer changes when an unrelated nested transaction rolls back', async () => {
    const rental = await fixture();
    await kit.dataSource.transaction(async manager => {
      await rentalsRepository.recordStatusChange(
        manager,
        rental.rentalId,
        'BOOKED',
        rental.rentedAt,
      );
      await expect(
        manager.transaction(async nestedManager => {
          await nestedManager.update(Rental, rental.rentalId, { status: 'OVERDUE' });
          await rentalsRepository.recordStatusChange(
            nestedManager,
            rental.rentalId,
            'ACTIVE',
            new Date(),
          );
          throw new Error('Savepoint rollback');
        }),
      ).rejects.toThrow('Savepoint rollback');
    });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(await kit.dataSource.getRepository(RentalOutboxEvent).count()).toBe(1);
  });

  it('does not wake for transactions that insert no outbox events', async () => {
    const rental = await fixture();
    await kit.dataSource.transaction(manager =>
      manager.findOneByOrFail(Rental, { rentalId: rental.rentalId }),
    );
    expect(wake).not.toHaveBeenCalled();
  });

  it('does not leak dirty state when a query runner is reused after rollback', async () => {
    const rental = await fixture();
    const writer = kit.dataSource.createQueryRunner();
    await writer.connect();
    try {
      await writer.startTransaction();
      await rentalsRepository.recordStatusChange(
        writer.manager,
        rental.rentalId,
        'BOOKED',
        rental.rentedAt,
      );
      await writer.rollbackTransaction();
      await writer.startTransaction();
      await writer.query('SELECT 1');
      await writer.commitTransaction();
      expect(wake).not.toHaveBeenCalled();
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
    }
  });

  it('never converts committed business data into an HTTP failure when a wake fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const rental = await fixture();
    wake.mockImplementationOnce(() => {
      throw new Error('Wake failed');
    });
    await expect(
      kit.dataSource.transaction(manager =>
        rentalsRepository.recordStatusChange(manager, rental.rentalId, 'BOOKED', rental.rentedAt),
      ),
    ).resolves.toBeUndefined();
    const second = await fixture();
    wake.mockRejectedValueOnce(new Error('Async wake failed'));
    await expect(
      kit.dataSource.transaction(manager =>
        rentalsRepository.recordStatusChange(manager, second.rentalId, 'BOOKED', second.rentedAt),
      ),
    ).resolves.toBeUndefined();
    expect(await kit.dataSource.getRepository(RentalOutboxEvent).count()).toBe(2);
  });
});
