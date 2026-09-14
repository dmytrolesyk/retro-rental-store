import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import pg from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Env } from 'src/config/env.schema';
import { DB_CONNECTION } from './constants';

@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      useFactory: (configService: ConfigService<Env, true>) => {
        const PG_HOST = configService.get('PG_HOST', { infer: true });
        const PG_PORT = configService.get('PG_PORT', { infer: true });
        const PG_USER = configService.get('PG_USER', { infer: true });
        const PG_DB = configService.get('PG_DB', { infer: true });
        const PG_PASSWORD_FILE = configService.get('PG_PASSWORD_FILE', {
          infer: true,
        });

        const SECRET_FILE = path.resolve(PG_PASSWORD_FILE);

        const pool = new pg.Pool({
          host: PG_HOST,
          port: PG_PORT,
          database: PG_DB,
          user: PG_USER,
          password: async () => {
            const pw = await readFile(SECRET_FILE, 'utf8');
            return pw.trim();
          },
          max: 3,
        });

        pool.on('error', () => {
          console.log(`Server closed idle connection during rotation`);
        });

        return pool;
      },
      inject: [ConfigService],
    },
  ],
  exports: [DB_CONNECTION],
})
export class DatabaseModule {}
