import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobEmailRecipient1792051200001 implements MigrationInterface {
  name = 'AddJobEmailRecipient1792051200001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE rental_jobs ADD COLUMN email_to varchar(120)');
    // Historical tasks did not have a snapshot; capture the current address once.
    await queryRunner.query(`UPDATE rental_jobs j SET email_to = r.email
      FROM rentals rental JOIN renters r ON r.renter_id = rental.renter_id
      WHERE rental.rental_id = j.rental_id`);
    await queryRunner.query('ALTER TABLE rental_jobs ALTER COLUMN email_to SET NOT NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE rental_jobs DROP COLUMN email_to');
  }
}
