\set ON_ERROR_STOP on

BEGIN;

\copy public.platforms (platform_id, name, description, description_uk, release_date) FROM '/fixtures/retronian/platforms.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"')

\copy public.genres (genre_id, name, description) FROM '/fixtures/retronian/genres.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"')

\copy public.games (game_id, game_cover_url, name, name_uk, description, description_uk, release_date, data_source) FROM '/fixtures/retronian/games.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"')

\copy public.game_platforms (game_id, platform_id) FROM '/fixtures/retronian/game_platforms.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"')

\copy public.game_genres (game_id, genre_id) FROM '/fixtures/retronian/game_genres.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"')

WITH synthetic_games AS (
  SELECT ordinal
  FROM generate_series(
    1,
    100000 - (SELECT count(*)::integer FROM public.games)
  ) AS generated(ordinal)
)
INSERT INTO public.games (
  game_id,
  game_cover_url,
  name,
  name_uk,
  description,
  description_uk,
  release_date,
  data_source
)
SELECT
  md5('synthetic-game:' || ordinal)::uuid,
  NULL,
  'Synthetic Game ' || ordinal,
  CASE
    WHEN ordinal BETWEEN 1 AND 200 THEN 'Космічна пригода ' || ordinal
    ELSE 'Навчальна гра ' || ordinal
  END,
  'Synthetic catalog entry ' || ordinal || ' for database performance testing.',
  CASE
    WHEN ordinal BETWEEN 201 AND 3000
      THEN 'Космічна пригода чекає на гравця у цьому навчальному записі каталогу.'
    WHEN ordinal BETWEEN 3001 AND 4000
      THEN 'Космічні пригоди чекають на гравця у цьому навчальному записі каталогу.'
    ELSE 'Це навчальний запис гри ' || ordinal || ' для перевірки роботи каталогу.'
  END,
  DATE '1980-01-01'
    + ((ordinal - 1) % (DATE '2026-01-01' - DATE '1980-01-01')),
  'synthetic'
FROM synthetic_games;

COMMIT;

VACUUM (ANALYZE);
