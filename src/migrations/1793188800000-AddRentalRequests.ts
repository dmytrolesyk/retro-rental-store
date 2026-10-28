import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRentalRequests1793188800000 implements MigrationInterface {
  name = 'AddRentalRequests1793188800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE rental_requests (
      idempotency_key varchar(128) PRIMARY KEY,
      request_hash varchar(64) NOT NULL,
      response jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT rental_requests_response_check CHECK (response IS NULL OR jsonb_typeof(response) = 'object')
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE rental_requests');
  }
}
