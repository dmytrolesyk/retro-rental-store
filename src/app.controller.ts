import { Controller, Get, HttpCode, Inject } from '@nestjs/common';
import { DB_CONNECTION } from './database/constants';
import { Pool } from 'pg';

const started = Date.now();

@Controller('/')
export class AppController {
  constructor(@Inject(DB_CONNECTION) private readonly db: Pool) {}

  @Get('health')
  @HttpCode(200)
  health() {
    return { uptime: (Date.now() - started) / 1000 };
  }
  @Get('db')
  async checkDb() {
    const queryResult = await this.db.query<{
      current_user: string;
      now: string;
    }>('SELECT current_user, now()::text AS now');
    return {
      dbQuery: queryResult.rows[0],
      uptime: (Date.now() - started) / 1000,
    };
  }
}
