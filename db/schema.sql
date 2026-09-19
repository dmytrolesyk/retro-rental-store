CREATE TYPE game_condition AS ENUM ('as_new', 'good', 'poor');
CREATE TYPE physical_format AS ENUM ('cartridge', 'optical_disc', 'floppy_disc', 'tape');
CREATE TYPE game_data_source AS ENUM ('retronian', 'synthetic', 'manual');

CREATE TABLE IF NOT EXISTS games (
  game_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_cover_url text,
  name text NOT NULL,
  name_uk text NOT NULL,
  description text NOT NULL,
  description_uk text NOT NULL,
  release_date date,
  data_source game_data_source NOT NULL DEFAULT 'manual',
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', name_uk), 'A') ||
    setweight(to_tsvector('simple', description_uk), 'B')
  ) STORED NOT NULL
);

CREATE TABLE IF NOT EXISTS platforms (
  platform_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL UNIQUE,
  description text NOT NULL,
  description_uk text NOT NULL,
  release_date date NOT NULL
);

CREATE TABLE IF NOT EXISTS game_platforms (
  game_id uuid NOT NULL REFERENCES games(game_id),
  platform_id uuid NOT NULL REFERENCES platforms(platform_id),

  PRIMARY KEY (game_id, platform_id)
);

CREATE TABLE IF NOT EXISTS game_copies (
  game_copy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(game_id),
  platform_id uuid NOT NULL REFERENCES platforms(platform_id),
  photo_url text,
  condition game_condition NOT NULL,
  format physical_format NOT NULL,
  price_per_day numeric(10,2) NOT NULL CHECK (price_per_day >= 0)
);

CREATE TABLE IF NOT EXISTS genres (
  genre_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL UNIQUE,
  description text
);

CREATE TABLE IF NOT EXISTS game_genres(
  game_id uuid NOT NULL REFERENCES games(game_id),
  genre_id uuid NOT NULL REFERENCES genres(genre_id),
  PRIMARY KEY (game_id, genre_id)
);

CREATE TABLE IF NOT EXISTS renters(
  renter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  email varchar(120) NOT NULL UNIQUE,
  phone_number varchar NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS rentals(
  rental_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id uuid NOT NULL REFERENCES renters(renter_id),
  rented_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rental_items(
  rental_id uuid NOT NULL REFERENCES rentals(rental_id),
  game_copy_id uuid NOT NULL REFERENCES game_copies(game_copy_id),
  returned_at timestamptz,
  cost_per_day numeric(10,2) NOT NULL CHECK (cost_per_day >= 0),

  PRIMARY KEY (rental_id, game_copy_id)
);

CREATE OR REPLACE FUNCTION check_rental_returned_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    rental_start timestamptz;
BEGIN
    SELECT rented_at
    INTO rental_start
    FROM rentals
    WHERE rental_id = NEW.rental_id;

    IF NEW.returned_at IS NOT NULL
       AND NEW.returned_at < rental_start THEN
        RAISE EXCEPTION
            'returned_at (%) cannot be earlier than rented_at (%)',
            NEW.returned_at,
            rental_start;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_items_returned_at_check
BEFORE INSERT OR UPDATE ON rental_items
FOR EACH ROW
EXECUTE FUNCTION check_rental_returned_at();
