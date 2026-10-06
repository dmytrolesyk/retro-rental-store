import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { DataSource } from 'typeorm';

describe('AppController', () => {
  let appController: AppController;
  const dbMock = {
    query: jest.fn().mockResolvedValue([{ current_user: 'db_app', now: 'now' }]),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: DataSource, useValue: dbMock }],
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
      const result = await appController.checkDb();
      expect(dbMock.query).toHaveBeenCalled();
      expect(result.dbQuery.current_user).toBe('db_app');
    });
  });
});
