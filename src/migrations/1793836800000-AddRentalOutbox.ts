import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRentalOutbox1793836800000 implements MigrationInterface {
  name = 'AddRentalOutbox1793836800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE rental_outbox_events (
      event_id uuid CONSTRAINT rental_outbox_events_pkey PRIMARY KEY,
      position bigserial NOT NULL,
      rental_id uuid NOT NULL CONSTRAINT rental_outbox_rental_fkey REFERENCES rentals(rental_id) ON DELETE RESTRICT,
      status text NOT NULL,
      payload jsonb NOT NULL,
      email_to varchar(120) NOT NULL,
      email_notification jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT rental_outbox_payload_check CHECK (
        COALESCE(payload->>'eventId', '') = event_id::text
        AND COALESCE(payload->>'rentalId', '') = rental_id::text
        AND COALESCE(payload->>'status', '') = status
        AND COALESCE(payload->>'version', '') = '1'
        AND COALESCE(payload->>'type', '') = 'rental.status-changed'
        AND status IN ('BOOKED','ACTIVE','OVERDUE','RETURNED','CANCELLED')))`);
    await queryRunner.query(
      'CREATE INDEX idx_rental_outbox_rental_position ON rental_outbox_events(rental_id, position)',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX idx_rental_outbox_rental_status ON rental_outbox_events(rental_id, status)',
    );
    await queryRunner.query(`CREATE TABLE rental_outbox_deliveries (
      event_id uuid NOT NULL CONSTRAINT rental_outbox_delivery_event_fkey REFERENCES rental_outbox_events(event_id) ON DELETE RESTRICT,
      consumer text NOT NULL,
      processed_at timestamptz,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_error text,
      CONSTRAINT rental_outbox_deliveries_pkey PRIMARY KEY(event_id, consumer),
      CONSTRAINT rental_outbox_consumer_check CHECK (consumer IN ('email','realtime')),
      CONSTRAINT rental_outbox_attempts_check CHECK (attempts >= 0))`);
    await queryRunner.query(
      `CREATE INDEX idx_rental_outbox_ready ON rental_outbox_deliveries(consumer, next_attempt_at, event_id) WHERE processed_at IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE rental_jobs ADD COLUMN outbox_event_id uuid,
      ADD CONSTRAINT rental_jobs_outbox_event_fkey FOREIGN KEY(outbox_event_id) REFERENCES rental_outbox_events(event_id) ON DELETE RESTRICT`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX idx_rental_jobs_outbox_event ON rental_jobs(outbox_event_id) WHERE outbox_event_id IS NOT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'LOCK TABLE rental_outbox_events, rental_outbox_deliveries, rental_jobs IN ACCESS EXCLUSIVE MODE',
    );
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM rental_outbox_events) THEN
        RAISE EXCEPTION 'Cannot discard rental outbox history';
      END IF;
    END $$`);
    await queryRunner.query('DROP INDEX idx_rental_jobs_outbox_event');
    await queryRunner.query(
      'ALTER TABLE rental_jobs DROP CONSTRAINT rental_jobs_outbox_event_fkey, DROP COLUMN outbox_event_id',
    );
    await queryRunner.query('DROP TABLE rental_outbox_deliveries');
    await queryRunner.query('DROP TABLE rental_outbox_events');
  }
}
