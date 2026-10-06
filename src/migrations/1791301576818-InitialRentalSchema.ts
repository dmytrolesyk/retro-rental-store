import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialRentalSchema1791301576818 implements MigrationInterface {
  name = 'InitialRentalSchema1791301576818';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "game_platforms" (
          "game_id" uuid NOT NULL,
          "platform_id" uuid NOT NULL,
          CONSTRAINT "game_platforms_pkey" PRIMARY KEY ("game_id", "platform_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "platforms" (
          "platform_id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "name" character varying(120) NOT NULL,
          "description" text NOT NULL,
          "description_uk" text NOT NULL,
          "release_date" date NOT NULL,
          CONSTRAINT "platforms_name_key" UNIQUE ("name"),
          CONSTRAINT "platforms_pkey" PRIMARY KEY ("platform_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "renters" (
          "renter_id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "name" character varying(80) NOT NULL,
          "email" character varying(120) NOT NULL,
          "phone_number" character varying NOT NULL,
          CONSTRAINT "renters_phone_number_key" UNIQUE ("phone_number"),
          CONSTRAINT "renters_email_key" UNIQUE ("email"),
          CONSTRAINT "renters_pkey" PRIMARY KEY ("renter_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "rentals" (
          "rental_id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "renter_id" uuid NOT NULL,
          "rented_at" TIMESTAMP WITH TIME ZONE NOT NULL,
          CONSTRAINT "rentals_pkey" PRIMARY KEY ("rental_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "rental_items" (
          "rental_id" uuid NOT NULL,
          "game_copy_id" uuid NOT NULL,
          "returned_at" TIMESTAMP WITH TIME ZONE,
          "cost_per_day" integer NOT NULL,
          CONSTRAINT "rental_items_cost_per_day_check" CHECK ("cost_per_day" >= 0),
          CONSTRAINT "rental_items_pkey" PRIMARY KEY ("rental_id", "game_copy_id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "one_active_rental_per_copy" ON "rental_items" ("game_copy_id") WHERE "returned_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."game_condition" AS ENUM('as_new', 'good', 'poor')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."physical_format" AS ENUM('cartridge', 'optical_disc', 'floppy_disc', 'tape')`,
    );
    await queryRunner.query(`
      CREATE TABLE "game_copies" (
          "game_copy_id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "game_id" uuid NOT NULL,
          "platform_id" uuid NOT NULL,
          "photo_url" text,
          "condition" "public"."game_condition" NOT NULL,
          "format" "public"."physical_format" NOT NULL,
          "price_per_day" integer NOT NULL,
          CONSTRAINT "game_copies_price_per_day_check" CHECK ("price_per_day" >= 0),
          CONSTRAINT "game_copies_pkey" PRIMARY KEY ("game_copy_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "genres" (
          "genre_id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "name" character varying(120) NOT NULL,
          "description" text,
          CONSTRAINT "genres_name_key" UNIQUE ("name"),
          CONSTRAINT "genres_pkey" PRIMARY KEY ("genre_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "game_genres" (
          "game_id" uuid NOT NULL,
          "genre_id" uuid NOT NULL,
          CONSTRAINT "game_genres_pkey" PRIMARY KEY ("game_id", "genre_id")
      )
    `);
    await queryRunner.query(
      `CREATE TYPE "public"."game_data_source" AS ENUM('retronian', 'synthetic', 'manual')`,
    );
    // TypeORM tracks the generated expression here; do not bind it to the generation database.
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value")
             VALUES (current_database(), $1, $2, $3, $4, $5)`,
      [
        'public',
        'games',
        'GENERATED_COLUMN',
        'search_vector',
        "setweight(to_tsvector('simple', name_uk), 'A') || setweight(to_tsvector('simple', description_uk), 'B')",
      ],
    );
    await queryRunner.query(`
      CREATE TABLE "games" (
          "game_id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "game_cover_url" text,
          "name" text NOT NULL,
          "name_uk" text NOT NULL,
          "description" text NOT NULL,
          "description_uk" text NOT NULL,
          "release_date" date,
          "data_source" "public"."game_data_source" NOT NULL DEFAULT 'manual',
          "search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', name_uk), 'A') || setweight(to_tsvector('simple', description_uk), 'B')) STORED NOT NULL,
          CONSTRAINT "games_pkey" PRIMARY KEY ("game_id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "game_platforms" ADD CONSTRAINT "game_platforms_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("game_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_platforms" ADD CONSTRAINT "game_platforms_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("platform_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rentals" ADD CONSTRAINT "rentals_renter_id_fkey" FOREIGN KEY ("renter_id") REFERENCES "renters"("renter_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "rentals"("rental_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_game_copy_id_fkey" FOREIGN KEY ("game_copy_id") REFERENCES "game_copies"("game_copy_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_copies" ADD CONSTRAINT "game_copies_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("game_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_copies" ADD CONSTRAINT "game_copies_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("platform_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_genres" ADD CONSTRAINT "game_genres_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("game_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_genres" ADD CONSTRAINT "game_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("genre_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // These indexes use PostgreSQL features maintained explicitly in migrations.
    await queryRunner.query(`CREATE INDEX "idx_rentals_renter_history"
            ON "rentals" ("renter_id", "rented_at" DESC, "rental_id" DESC)`);
    await queryRunner.query(`CREATE INDEX "idx_games_lower_name_uk"
            ON "games" (lower("name_uk"))`);
    await queryRunner.query(`CREATE INDEX "idx_games_search_vector"
            ON "games" USING GIN ("search_vector")`);

    // Preserve the date invariants from homework 12 in the database.
    await queryRunner.query(`
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
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER rental_items_returned_at_check
      BEFORE INSERT OR UPDATE ON rental_items
      FOR EACH ROW
      EXECUTE FUNCTION check_rental_returned_at()
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION check_rental_rented_at()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
          IF EXISTS (
              SELECT 1
              FROM rental_items
              WHERE rental_id = NEW.rental_id
                AND returned_at IS NOT NULL
                AND returned_at < NEW.rented_at
          ) THEN
              RAISE EXCEPTION
                  'rented_at (%) cannot be later than an existing returned_at',
                  NEW.rented_at;
          END IF;

          RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER rentals_rented_at_check
      BEFORE UPDATE OF rented_at ON rentals
      FOR EACH ROW
      EXECUTE FUNCTION check_rental_rented_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove manual objects before dropping their tables.
    await queryRunner.query(`DROP TRIGGER "rentals_rented_at_check" ON "rentals"`);
    await queryRunner.query(`DROP TRIGGER "rental_items_returned_at_check" ON "rental_items"`);
    await queryRunner.query(`DROP FUNCTION "check_rental_rented_at"()`);
    await queryRunner.query(`DROP FUNCTION "check_rental_returned_at"()`);
    await queryRunner.query(`DROP INDEX "public"."idx_games_search_vector"`);
    await queryRunner.query(`DROP INDEX "public"."idx_games_lower_name_uk"`);
    await queryRunner.query(`DROP INDEX "public"."idx_rentals_renter_history"`);

    await queryRunner.query(
      `ALTER TABLE "game_genres" DROP CONSTRAINT "game_genres_genre_id_fkey"`,
    );
    await queryRunner.query(`ALTER TABLE "game_genres" DROP CONSTRAINT "game_genres_game_id_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "game_copies" DROP CONSTRAINT "game_copies_platform_id_fkey"`,
    );
    await queryRunner.query(`ALTER TABLE "game_copies" DROP CONSTRAINT "game_copies_game_id_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "rental_items" DROP CONSTRAINT "rental_items_game_copy_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rental_items" DROP CONSTRAINT "rental_items_rental_id_fkey"`,
    );
    await queryRunner.query(`ALTER TABLE "rentals" DROP CONSTRAINT "rentals_renter_id_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "game_platforms" DROP CONSTRAINT "game_platforms_platform_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_platforms" DROP CONSTRAINT "game_platforms_game_id_fkey"`,
    );
    await queryRunner.query(`DROP TABLE "games"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata"
             WHERE "type" = $1 AND "name" = $2 AND "database" = current_database()
               AND "schema" = $3 AND "table" = $4`,
      ['GENERATED_COLUMN', 'search_vector', 'public', 'games'],
    );
    await queryRunner.query(`DROP TYPE "public"."game_data_source"`);
    await queryRunner.query(`DROP TABLE "game_genres"`);
    await queryRunner.query(`DROP TABLE "genres"`);
    await queryRunner.query(`DROP TABLE "game_copies"`);
    await queryRunner.query(`DROP TYPE "public"."physical_format"`);
    await queryRunner.query(`DROP TYPE "public"."game_condition"`);
    await queryRunner.query(`DROP INDEX "public"."one_active_rental_per_copy"`);
    await queryRunner.query(`DROP TABLE "rental_items"`);
    await queryRunner.query(`DROP TABLE "rentals"`);
    await queryRunner.query(`DROP TABLE "renters"`);
    await queryRunner.query(`DROP TABLE "platforms"`);
    await queryRunner.query(`DROP TABLE "game_platforms"`);
  }
}
