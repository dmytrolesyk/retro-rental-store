import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { DataSource } from 'typeorm';

describe('AppController', () => {
  let appController: AppController;
  const dataSourceMock = {
    query: jest.fn().mockResolvedValue([{ current_user: 'db_app', now: 'now' }]),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: DataSource, useValue: dataSourceMock }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return uptime', () => {
      expect(appController.health().uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('db', () => {
    it('should return the query result', async () => {
      const databaseStatus = await appController.checkDb();
      expect(dataSourceMock.query).toHaveBeenCalled();
      expect(databaseStatus.dbQuery.current_user).toBe('db_app');
    });
  });
});
