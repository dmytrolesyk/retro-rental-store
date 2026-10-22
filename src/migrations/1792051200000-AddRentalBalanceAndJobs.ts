import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRentalBalanceAndJobs1792051200000 implements MigrationInterface {
  name = 'AddRentalBalanceAndJobs1792051200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing renters start with zero credit; historical rental data stays intact.
    await queryRunner.query(`
      ALTER TABLE "renters"
      ADD COLUMN "balance" integer NOT NULL DEFAULT 0,
      ADD CONSTRAINT "renters_balance_check" CHECK ("balance" >= 0)
    `);
    await queryRunner.query(`
      CREATE TABLE "rental_jobs" (
        "job_id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "rental_id" uuid NOT NULL,
        "status" text NOT NULL DEFAULT 'new',
        "processed" integer NOT NULL DEFAULT 0,
        "worker" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "rental_jobs_pkey" PRIMARY KEY ("job_id"),
        CONSTRAINT "rental_jobs_status_check" CHECK ("status" IN ('new', 'done')),
        CONSTRAINT "rental_jobs_processed_check" CHECK ("processed" >= 0),
        CONSTRAINT "rental_jobs_rental_id_fkey" FOREIGN KEY ("rental_id")
          REFERENCES "rentals" ("rental_id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_rental_jobs_rental" ON "rental_jobs" ("rental_id")`);
    await queryRunner.query(`
      CREATE INDEX "idx_rental_jobs_new" ON "rental_jobs" ("created_at", "job_id")
      WHERE "status" = 'new'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback removes the new queue and balances, but keeps renters and rentals.
    await queryRunner.query(`DROP TABLE "rental_jobs"`);
    await queryRunner.query(`ALTER TABLE "renters" DROP CONSTRAINT "renters_balance_check"`);
    await queryRunner.query(`ALTER TABLE "renters" DROP COLUMN "balance"`);
  }
}
