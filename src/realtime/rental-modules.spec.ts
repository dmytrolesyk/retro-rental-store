jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { OutboxCommitSubscriber } from '../outbox/outbox-commit.subscriber';
import { RentalOutboxDispatcher } from '../outbox/rental-outbox.dispatcher';
import { RentalOutboxModule } from '../outbox/rental-outbox.module';
import { RentalEventsModule } from './rental-events.module';
import { RentalEventsService } from './rental-events.service';
import { RentalReplayModule } from './rental-replay.module';
import { RentalReplayService } from './rental-replay.service';

const dataSource = { subscribers: [] as unknown[], getRepository: jest.fn() };
@Global()
@Module({ providers: [{ provide: DataSource, useValue: dataSource }], exports: [DataSource] })
class DatabaseStubModule {}

@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: { get: () => false } }],
  exports: [ConfigService],
})
class DisabledRelayConfigModule {}

describe('rental event module boundaries', () => {
  beforeEach(() => {
    dataSource.subscribers.length = 0;
    dataSource.getRepository.mockClear();
  });

  it('initializes replay without relay configuration, subscribers, timers or startup DB reads', async () => {
    const module = await Test.createTestingModule({
      imports: [DatabaseStubModule, RentalReplayModule],
    }).compile();
    try {
      await module.init();
      expect(module.get(RentalReplayService)).toBeInstanceOf(RentalReplayService);
      expect(() => module.get(RentalOutboxDispatcher)).toThrow();
      expect(() => module.get(OutboxCommitSubscriber)).toThrow();
      expect(dataSource.subscribers).toHaveLength(0);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('shares one bus when replay and relay are composed, and cleans up their lifecycle', async () => {
    const module = await Test.createTestingModule({
      imports: [
        DatabaseStubModule,
        DisabledRelayConfigModule,
        RentalReplayModule,
        RentalOutboxModule,
      ],
    }).compile();
    const completed = jest.fn();
    try {
      await module.init();
      const bus = module.get(RentalEventsService);
      expect(module.select(RentalEventsModule).get(RentalEventsService, { strict: true })).toBe(
        bus,
      );
      bus.forRental('rental-id').subscribe({ complete: completed });
      expect(dataSource.subscribers).toHaveLength(1);
      expect(dataSource.subscribers[0]).toBeInstanceOf(OutboxCommitSubscriber);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
    expect(completed).toHaveBeenCalledTimes(1);
    expect(dataSource.subscribers).toHaveLength(0);
  });
});
