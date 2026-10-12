import { Controller, Get, HttpCode } from '@nestjs/common';
import { DataSource } from 'typeorm';

const started = Date.now();

@Controller('/')
export class AppController {
  constructor(private readonly db: DataSource) {}

  @Get('health')
  @HttpCode(200)
  health() {
    return { uptime: (Date.now() - started) / 1000 };
  }
  @Get('db')
  async checkDb() {
    const queryResult = await this.db.query<
      {
        current_user: string;
        now: string;
      }[]
    >('SELECT current_user, now()::text AS now');
    return {
      dbQuery: queryResult[0],
      uptime: (Date.now() - started) / 1000,
    };
  }
}
