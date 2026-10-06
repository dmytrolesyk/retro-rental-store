import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { GameDataSource, PhysicalFormat } from '../entities';

const fixturesDirectory = join(__dirname, '../../../db/fixtures/retronian');
const nullableText = z.string().transform(value => (value === '\\N' ? null : value));

function readFixture<T>(filename: string, schema: z.ZodType<T>): T[] {
  const content = readFileSync(join(fixturesDirectory, filename), 'utf8');
  const records: unknown = parse(content, {
    delimiter: '\t',
    columns: true,
    skip_empty_lines: true,
  });
  return z.array(schema).parse(records);
}

// These are the same checked-in CSV-escaped TSV files used in homework 12.
// Paths are relative to this module, so source and compiled code find the same files.
export function readRetronianCatalog() {
  const platforms = readFixture(
    'platforms.tsv',
    z.object({
      platform_id: z.uuid(),
      name: z.string().min(1),
      description: z.string(),
      description_uk: z.string(),
      release_date: z.iso.date(),
    }),
  ).map(row => ({
    platformId: row.platform_id,
    name: row.name,
    description: row.description,
    descriptionUk: row.description_uk,
    releaseDate: row.release_date,
  }));

  const genres = readFixture(
    'genres.tsv',
    z.object({ genre_id: z.uuid(), name: z.string().min(1), description: nullableText }),
  ).map(row => ({ genreId: row.genre_id, name: row.name, description: row.description }));

  const games = readFixture(
    'games.tsv',
    z.object({
      game_id: z.uuid(),
      game_cover_url: nullableText,
      name: z.string().min(1),
      name_uk: z.string().min(1),
      description: z.string(),
      description_uk: z.string(),
      release_date: z
        .union([z.iso.date(), z.literal('\\N')])
        .transform(value => (value === '\\N' ? null : value)),
      data_source: z.enum(GameDataSource),
    }),
  ).map(row => ({
    gameId: row.game_id,
    gameCoverUrl: row.game_cover_url,
    name: row.name,
    nameUk: row.name_uk,
    description: row.description,
    descriptionUk: row.description_uk,
    releaseDate: row.release_date,
    dataSource: row.data_source,
  }));

  const gamePlatforms = readFixture(
    'game_platforms.tsv',
    z.object({ game_id: z.uuid(), platform_id: z.uuid() }),
  ).map(row => ({ gameId: row.game_id, platformId: row.platform_id }));

  const gameGenres = readFixture(
    'game_genres.tsv',
    z.object({ game_id: z.uuid(), genre_id: z.uuid() }),
  ).map(row => ({ gameId: row.game_id, genreId: row.genre_id }));

  // This file describes formats for platforms; it is not a separate SQL table.
  const platformFormats = readFixture(
    'platform_formats.tsv',
    z.object({ platform_id: z.uuid(), format: z.enum(PhysicalFormat) }),
  ).map(row => ({ platformId: row.platform_id, format: row.format }));

  return { platforms, genres, games, gamePlatforms, gameGenres, platformFormats };
}
