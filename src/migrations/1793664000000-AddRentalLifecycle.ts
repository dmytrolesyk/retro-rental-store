import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Expand the legacy issued-rental model without rewriting physical return history. */
export class AddRentalLifecycle1793664000000 implements MigrationInterface {
  name = 'AddRentalLifecycle1793664000000';

  async up(db: QueryRunner): Promise<void> {
    await db.query(`ALTER TABLE rentals
      ALTER COLUMN rented_at DROP NOT NULL,
      ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE',
      ADD COLUMN booked_at timestamptz,
      ADD COLUMN booking_expires_at timestamptz,
      ADD COLUMN due_at timestamptz,
      ADD COLUMN cancelled_at timestamptz,
      ADD COLUMN cancelled_by text,
      ADD COLUMN cancellation_reason text`);
    await db.query(`UPDATE rentals r SET
      due_at = rented_at + interval '24 hours',
      status = CASE WHEN EXISTS (SELECT 1 FROM rental_items i WHERE i.rental_id = r.rental_id)
        AND NOT EXISTS (SELECT 1 FROM rental_items i WHERE i.rental_id = r.rental_id AND i.returned_at IS NULL)
        THEN 'RETURNED' ELSE 'ACTIVE' END`);
    // A legacy row has no known booking time. Leave it NULL rather than inventing history.
    await db.query(`ALTER TABLE rentals
      ADD CONSTRAINT rentals_status_check CHECK (status IN ('BOOKED','ACTIVE','OVERDUE','RETURNED','CANCELLED')),
      ADD CONSTRAINT rentals_booking_dates_check CHECK (
        (booked_at IS NULL AND booking_expires_at IS NULL) OR
        (booked_at IS NOT NULL AND booking_expires_at IS NOT NULL AND booking_expires_at > booked_at)),
      ADD CONSTRAINT rentals_issue_dates_check CHECK (
        (rented_at IS NULL AND due_at IS NULL) OR
        (rented_at IS NOT NULL AND due_at IS NOT NULL AND due_at > rented_at AND
          (booked_at IS NULL OR (rented_at >= booked_at AND rented_at < booking_expires_at)))),
      ADD CONSTRAINT rentals_lifecycle_check CHECK (
        (status = 'BOOKED' AND booked_at IS NOT NULL AND rented_at IS NULL AND
          cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL) OR
        (status IN ('ACTIVE','OVERDUE','RETURNED') AND rented_at IS NOT NULL AND
          cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL) OR
        (status = 'CANCELLED' AND booked_at IS NOT NULL AND rented_at IS NULL AND
          cancelled_at IS NOT NULL AND cancelled_at >= booked_at AND
          cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0))`);
    await db.query(
      `CREATE INDEX idx_rentals_booking_expiry ON rentals (booking_expires_at, rental_id) WHERE status = 'BOOKED'`,
    );
    await db.query(
      `CREATE INDEX idx_rentals_due ON rentals (due_at, rental_id) WHERE status = 'ACTIVE'`,
    );
    await db.query(`ALTER TABLE rental_items ADD COLUMN released_at timestamptz`);
    await db.query(`UPDATE rental_items SET released_at = returned_at`);
    await db.query(`DROP INDEX one_active_rental_per_copy`);
    // A partial index can reference only its own table. released_at is maintained by
    // triggers so cancelled reservations and physical returns both release a copy.
    await db.query(
      `CREATE UNIQUE INDEX one_active_rental_per_copy ON rental_items (game_copy_id) WHERE released_at IS NULL`,
    );

    await db.query(`CREATE FUNCTION initialize_rental_issue_dates() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status IN ('ACTIVE','OVERDUE','RETURNED') AND NEW.rented_at IS NOT NULL AND NEW.due_at IS NULL THEN
          NEW.due_at := NEW.rented_at + interval '24 hours';
        END IF;
        RETURN NEW;
      END $$`);
    await db.query(`CREATE TRIGGER rentals_initialize_issue_dates BEFORE INSERT ON rentals
      FOR EACH ROW EXECUTE FUNCTION initialize_rental_issue_dates()`);

    // Replace the original date trigger: retain date validation and serialize with
    // cancellation/issue on the parent. Callers must acquire the parent before items.
    await db.query(`CREATE OR REPLACE FUNCTION check_rental_returned_at() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE parent rentals%ROWTYPE;
      BEGIN
        SELECT * INTO parent FROM rentals WHERE rental_id = NEW.rental_id FOR NO KEY UPDATE;
        IF NOT FOUND THEN RETURN NEW; END IF; -- the foreign key reports a missing parent
        IF NEW.returned_at IS NOT NULL AND
          (parent.rented_at IS NULL OR NEW.returned_at < parent.rented_at) THEN
          RAISE EXCEPTION 'returned_at cannot precede physical issue' USING ERRCODE = '23514';
        END IF;
        IF parent.status = 'CANCELLED' THEN
          IF NEW.returned_at IS NOT NULL THEN
            RAISE EXCEPTION 'a cancelled booking has no physical return' USING ERRCODE = '23514';
          END IF;
          NEW.released_at := parent.cancelled_at;
        ELSIF NEW.returned_at IS NOT NULL THEN
          NEW.released_at := NEW.returned_at;
        ELSE
          IF parent.status = 'RETURNED' THEN
            RAISE EXCEPTION 'a returned rental cannot hold an unreturned copy' USING ERRCODE = '23514';
          END IF;
          NEW.released_at := NULL;
        END IF;
        RETURN NEW;
      END $$`);
    await db.query(`CREATE FUNCTION release_cancelled_rental_items() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'CANCELLED' THEN
          UPDATE rental_items SET released_at = NEW.cancelled_at WHERE rental_id = NEW.rental_id;
        END IF;
        RETURN NEW;
      END $$`);
    await db.query(`CREATE TRIGGER rentals_release_cancelled_items AFTER UPDATE OF status, cancelled_at ON rentals
      FOR EACH ROW EXECUTE FUNCTION release_cancelled_rental_items()`);
    // The previous parent-side trigger must also reject erasing an issue date
    // underneath an existing physical return.
    await db.query(`CREATE OR REPLACE FUNCTION check_rental_rented_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM rental_items WHERE rental_id = NEW.rental_id
          AND returned_at IS NOT NULL AND (NEW.rented_at IS NULL OR returned_at < NEW.rented_at)) THEN
          RAISE EXCEPTION 'rented_at cannot be later than an existing returned_at or removed'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'RETURNED' AND EXISTS (SELECT 1 FROM rental_items
          WHERE rental_id = NEW.rental_id AND returned_at IS NULL) THEN
          RAISE EXCEPTION 'a returned rental cannot have outstanding items' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$`);
    await db.query(`DROP TRIGGER rentals_rented_at_check ON rentals`);
    await db.query(`CREATE TRIGGER rentals_rented_at_check BEFORE UPDATE OF rented_at, status ON rentals
      FOR EACH ROW EXECUTE FUNCTION check_rental_rented_at()`);
  }

  async down(db: QueryRunner): Promise<void> {
    // The old schema cannot represent bookings/cancellations. Refuse to destroy
    // their history or manufacture rented_at/returned_at dates to make it fit.
    // Lock before reading the guard: a concurrent uncommitted booking must be
    // visible once we decide whether dropping its history is safe.
    await db.query(`LOCK TABLE rentals, rental_items IN ACCESS EXCLUSIVE MODE`);
    await db.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM rentals WHERE booked_at IS NOT NULL OR rented_at IS NULL OR status = 'OVERDUE') THEN
        RAISE EXCEPTION 'Cannot revert rental lifecycle: new lifecycle data exists';
      END IF;
    END $$`);
    await db.query(`DROP TRIGGER rentals_release_cancelled_items ON rentals`);
    await db.query(`DROP FUNCTION release_cancelled_rental_items()`);
    await db.query(`DROP TRIGGER rentals_initialize_issue_dates ON rentals`);
    await db.query(`DROP FUNCTION initialize_rental_issue_dates()`);
    await db.query(`CREATE OR REPLACE FUNCTION check_rental_returned_at() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE rental_start timestamptz;
      BEGIN
        SELECT rented_at INTO rental_start FROM rentals WHERE rental_id = NEW.rental_id;
        IF NEW.returned_at IS NOT NULL AND NEW.returned_at < rental_start THEN
          RAISE EXCEPTION 'returned_at (%) cannot be earlier than rented_at (%)', NEW.returned_at, rental_start;
        END IF;
        RETURN NEW;
      END $$`);
    await db.query(`CREATE OR REPLACE FUNCTION check_rental_rented_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM rental_items WHERE rental_id = NEW.rental_id
          AND returned_at IS NOT NULL AND returned_at < NEW.rented_at) THEN
          RAISE EXCEPTION 'rented_at (%) cannot be later than an existing returned_at', NEW.rented_at;
        END IF;
        RETURN NEW;
      END $$`);
    await db.query(`DROP TRIGGER rentals_rented_at_check ON rentals`);
    await db.query(`CREATE TRIGGER rentals_rented_at_check BEFORE UPDATE OF rented_at ON rentals
      FOR EACH ROW EXECUTE FUNCTION check_rental_rented_at()`);
    await db.query(`DROP INDEX one_active_rental_per_copy`);
    await db.query(
      `CREATE UNIQUE INDEX one_active_rental_per_copy ON rental_items (game_copy_id) WHERE returned_at IS NULL`,
    );
    await db.query(`ALTER TABLE rental_items DROP COLUMN released_at`);
    await db.query(`DROP INDEX idx_rentals_booking_expiry`);
    await db.query(`DROP INDEX idx_rentals_due`);
    await db.query(`ALTER TABLE rentals
      DROP CONSTRAINT rentals_lifecycle_check, DROP CONSTRAINT rentals_issue_dates_check,
      DROP CONSTRAINT rentals_booking_dates_check, DROP CONSTRAINT rentals_status_check,
      DROP COLUMN cancellation_reason, DROP COLUMN cancelled_by, DROP COLUMN cancelled_at,
      DROP COLUMN due_at, DROP COLUMN booking_expires_at, DROP COLUMN booked_at, DROP COLUMN status,
      ALTER COLUMN rented_at SET NOT NULL`);
  }
}
