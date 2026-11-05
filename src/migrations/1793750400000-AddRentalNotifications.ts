import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRentalNotifications1793750400000 implements MigrationInterface {
  name = 'AddRentalNotifications1793750400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE rental_jobs
      DROP CONSTRAINT rental_jobs_status_check,
      ADD CONSTRAINT rental_jobs_status_check CHECK (status IN ('new','done','failed')),
      ADD COLUMN notification_status text,
      ADD COLUMN notification jsonb,
      ADD COLUMN delivery_payload jsonb,
      ADD COLUMN attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN first_attempt_at timestamptz,
      ADD COLUMN last_error text,
      ADD CONSTRAINT rental_jobs_attempts_check CHECK (attempts >= 0),
      ADD CONSTRAINT rental_jobs_notification_check CHECK (
        (notification_status IS NULL AND notification IS NULL) OR
        (notification_status IS NOT NULL AND notification IS NOT NULL
          AND notification_status IN ('BOOKED','ACTIVE','OVERDUE','RETURNED','CANCELLED')
          AND COALESCE(notification->>'status', '') = notification_status AND COALESCE(notification->>'version', '') = '1'))`);
    await queryRunner.query(`CREATE UNIQUE INDEX idx_rental_jobs_status_email
      ON rental_jobs(rental_id, notification_status) WHERE notification_status IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_rental_jobs_ready
      ON rental_jobs(next_attempt_at, created_at, job_id) WHERE status = 'new'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Guard and alteration share the lock: a concurrent enqueue cannot evade the check.
    await queryRunner.query('LOCK TABLE rental_jobs IN ACCESS EXCLUSIVE MODE');
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM rental_jobs WHERE notification_status IS NOT NULL
        OR delivery_payload IS NOT NULL OR attempts <> 0 OR first_attempt_at IS NOT NULL
        OR last_error IS NOT NULL OR status = 'failed') THEN
        RAISE EXCEPTION 'Cannot discard rental email snapshots or delivery state';
      END IF;
    END $$`);
    await queryRunner.query(`DROP INDEX idx_rental_jobs_ready`);
    await queryRunner.query(`DROP INDEX idx_rental_jobs_status_email`);
    await queryRunner.query(`ALTER TABLE rental_jobs
      DROP CONSTRAINT rental_jobs_status_check,
      DROP CONSTRAINT rental_jobs_attempts_check,
      DROP CONSTRAINT rental_jobs_notification_check,
      DROP COLUMN notification_status, DROP COLUMN notification, DROP COLUMN delivery_payload,
      DROP COLUMN attempts, DROP COLUMN next_attempt_at, DROP COLUMN first_attempt_at,
      DROP COLUMN last_error,
      ADD CONSTRAINT rental_jobs_status_check CHECK (status IN ('new','done'))`);
  }
}
