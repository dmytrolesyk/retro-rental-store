import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { DB_CONNECTION } from './database/constants';

describe('AppController', () => {
  let appController: AppController;
  const dbMock = {
    query: jest
      .fn()
      .mockResolvedValue({ rows: [{ current_user: 'app_user', now: 'now' }] }),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: DB_CONNECTION, useValue: dbMock }],
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
      expect(result.dbQuery.current_user).toBe('app_user');
    });
  });
});
