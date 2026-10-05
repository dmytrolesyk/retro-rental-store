\set ON_ERROR_STOP on

BEGIN;

COPY public.platforms (platform_id, name, description, description_uk, release_date) FROM '/fixtures/retronian/platforms.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"');

COPY public.genres (genre_id, name, description) FROM '/fixtures/retronian/genres.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"');

COPY public.games (game_id, game_cover_url, name, name_uk, description, description_uk, release_date, data_source) FROM '/fixtures/retronian/games.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"');

COPY public.game_platforms (game_id, platform_id) FROM '/fixtures/retronian/game_platforms.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"');

COPY public.game_genres (game_id, genre_id) FROM '/fixtures/retronian/game_genres.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"');

CREATE TEMP TABLE seed_platform_formats (
  platform_id uuid PRIMARY KEY,
  format physical_format NOT NULL
) ON COMMIT DROP;

COPY seed_platform_formats (platform_id, format) FROM '/fixtures/retronian/platform_formats.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '\N', QUOTE '"');

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

WITH selected_game_platforms AS (
  SELECT
    gp.game_id,
    gp.platform_id,
    platform_format.format,
    row_number() OVER (ORDER BY gp.game_id, gp.platform_id) AS ordinal
  FROM public.game_platforms AS gp
  JOIN public.games AS game ON game.game_id = gp.game_id
  JOIN seed_platform_formats AS platform_format
    ON platform_format.platform_id = gp.platform_id
  WHERE game.data_source = 'retronian'
  ORDER BY gp.game_id, gp.platform_id
  LIMIT 8000
)
INSERT INTO public.game_copies (
  game_copy_id,
  game_id,
  platform_id,
  photo_url,
  condition,
  format,
  price_per_day
)
SELECT
  md5('game-copy:' || ordinal)::uuid,
  game_id,
  platform_id,
  NULL,
  CASE
    WHEN (ordinal - 1) % 20 BETWEEN 0 AND 2 THEN 'as_new'
    WHEN (ordinal - 1) % 20 BETWEEN 3 AND 16 THEN 'good'
    ELSE 'poor'
  END::game_condition,
  format,
  (50 + ((ordinal - 1) % 151))::numeric(10, 2)
FROM selected_game_platforms;

INSERT INTO public.renters (
  renter_id,
  name,
  email,
  phone_number
)
SELECT
  md5('renter:' || ordinal)::uuid,
  'Renter ' || ordinal,
  'renter' || ordinal || '@example.com',
  '+38050' || lpad(ordinal::text, 7, '0')
FROM generate_series(1, 10000) AS generated(ordinal);

WITH generated_rentals AS (
  SELECT
    ordinal,
    CASE
      WHEN ordinal <= 50 THEN 1
      WHEN ordinal <= 40000 THEN 2 + ((ordinal - 51) % 499)
      ELSE 501 + ((ordinal - 40001) % 9500)
    END AS renter_ordinal
  FROM generate_series(1, 100000) AS generated(ordinal)
)
INSERT INTO public.rentals (
  rental_id,
  renter_id,
  rented_at
)
SELECT
  md5('rental:' || ordinal)::uuid,
  md5('renter:' || renter_ordinal)::uuid,
  CASE
    WHEN ordinal <= 50 THEN
      TIMESTAMPTZ '2025-01-01 00:00:00+00'
        + (ordinal - 1) * INTERVAL '168 hours'
    WHEN ordinal <= 70000 THEN
      TIMESTAMPTZ '2021-01-01 00:00:00+00'
        + (
          (ordinal - 51)
          % (DATE '2026-01-01' - DATE '2021-01-01')
        ) * INTERVAL '24 hours'
    ELSE
      TIMESTAMPTZ '2006-01-01 00:00:00+00'
        + (
          (ordinal - 70001)
          % (DATE '2021-01-01' - DATE '2006-01-01')
        ) * INTERVAL '24 hours'
  END
FROM generated_rentals;

WITH ranked_rentals AS (
  SELECT
    generated.ordinal AS rental_ordinal,
    rental.rental_id,
    rental.rented_at,
    row_number() OVER (
      ORDER BY rental.rented_at DESC, rental.rental_id DESC
    ) AS rental_recency
  FROM generate_series(1, 100000) AS generated(ordinal)
  JOIN public.rentals AS rental
    ON rental.rental_id = md5('rental:' || generated.ordinal)::uuid
),
generated_items AS (
  SELECT
    ranked_rentals.*,
    generated.item_position,
    ranked_rentals.rental_recency <= 500
      AND generated.item_position = 1 AS is_active
  FROM ranked_rentals
  CROSS JOIN LATERAL generate_series(
    1,
    CASE
      WHEN rental_ordinal <= 10000 THEN 3
      WHEN rental_ordinal <= 40000 THEN 2
      ELSE 1
    END
  ) AS generated(item_position)
),
numbered_items AS (
  SELECT
    generated_items.*,
    row_number() OVER (
      PARTITION BY is_active
      ORDER BY rental_ordinal, item_position
    ) AS status_ordinal
  FROM generated_items
),
assigned_items AS (
  SELECT
    numbered_items.*,
    CASE
      WHEN is_active THEN rental_recency
      WHEN (status_ordinal - 1) % 5 BETWEEN 0 AND 2
        THEN 501 + ((status_ordinal - 1) % 1000)
      ELSE 1501 + ((status_ordinal - 1) % 6500)
    END AS copy_ordinal
  FROM numbered_items
)
INSERT INTO public.rental_items (
  rental_id,
  game_copy_id,
  returned_at,
  cost_per_day
)
SELECT
  assigned_items.rental_id,
  game_copy.game_copy_id,
  CASE
    WHEN is_active THEN NULL
    ELSE LEAST(
      rented_at
        + (1 + ((status_ordinal - 1) % 14)) * INTERVAL '24 hours',
      TIMESTAMPTZ '2025-12-31 23:59:59+00'
    )
  END,
  game_copy.price_per_day
FROM assigned_items
JOIN public.game_copies AS game_copy
  ON game_copy.game_copy_id = md5(
    'game-copy:' || assigned_items.copy_ordinal
  )::uuid;

COMMIT;

VACUUM (ANALYZE);
