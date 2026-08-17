-- Centerline derived state and append-only enforcement.
-- Applied after every migration by db/migrate.ts. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Append-only enforcement on attendance_event.
--    The compliance requirement is that the log is immutable. Convention is not
--    enough; the database refuses.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION attendance_event_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'attendance_event is append-only: % is not permitted. Insert a new row with supersedes_id instead.',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attendance_event_no_update ON attendance_event;
CREATE TRIGGER attendance_event_no_update
  BEFORE UPDATE ON attendance_event
  FOR EACH ROW EXECUTE FUNCTION attendance_event_append_only();

DROP TRIGGER IF EXISTS attendance_event_no_delete ON attendance_event;
CREATE TRIGGER attendance_event_no_delete
  BEFORE DELETE ON attendance_event
  FOR EACH ROW EXECUTE FUNCTION attendance_event_append_only();

-- ---------------------------------------------------------------------------
-- 2. Live events: an event is dead once anything supersedes it.
--    Deadness is monotone, so a single NOT EXISTS is correct even for
--    multi-link correction chains (E1 <- E2 <- E3). A superseding row carrying
--    inference_basis = 'voided' means "this never happened" and is itself
--    excluded, which is how a mistaken event is retracted without a DELETE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW live_attendance_event AS
SELECT e.*
FROM attendance_event e
WHERE NOT EXISTS (
        SELECT 1 FROM attendance_event s WHERE s.supersedes_id = e.id
      )
  AND e.inference_basis IS DISTINCT FROM 'voided';

-- ---------------------------------------------------------------------------
-- 3. Sessions, derived. Never a table.
--    Pairing rule: each check_out pairs with the most recent preceding check_in;
--    consecutive same-type events collapse to the first (a child who scans twice
--    starts one session, not two).
--    session_date is the centre-LOCAL date of the check-in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW session_v AS
WITH ordered AS (
  SELECT
    e.id, e.centre_id, e.student_id, e.type, e.occurred_at,
    e.capture_method, e.inference_basis, e.confirmed_by, e.confirmed_at,
    (e.occurred_at AT TIME ZONE c.timezone)::date AS local_date,
    LAG(e.type) OVER (PARTITION BY e.student_id ORDER BY e.occurred_at, e.id) AS prev_type
  FROM live_attendance_event e
  JOIN centre c ON c.id = e.centre_id
),
deduped AS (
  SELECT * FROM ordered WHERE prev_type IS DISTINCT FROM type
),
paired AS (
  SELECT
    d.centre_id,
    d.student_id,
    d.type,
    d.id                                   AS check_in_id,
    d.occurred_at                          AS check_in_at,
    d.local_date                           AS session_date,
    d.capture_method                       AS check_in_method,
    LEAD(d.id)              OVER w         AS next_id,
    LEAD(d.occurred_at)     OVER w         AS next_at,
    LEAD(d.capture_method)  OVER w         AS next_method,
    LEAD(d.inference_basis) OVER w         AS next_basis,
    LEAD(d.confirmed_by)    OVER w         AS next_confirmed_by,
    LEAD(d.confirmed_at)    OVER w         AS next_confirmed_at,
    LEAD(d.type)            OVER w         AS next_type
  FROM deduped d
  WINDOW w AS (PARTITION BY d.student_id ORDER BY d.occurred_at, d.id)
)
SELECT
  centre_id,
  student_id,
  session_date,
  check_in_id,
  check_in_at,
  check_in_method,
  CASE WHEN next_type = 'check_out' THEN next_id            END AS check_out_id,
  CASE WHEN next_type = 'check_out' THEN next_at            END AS check_out_at,
  CASE WHEN next_type = 'check_out' THEN next_method        END AS check_out_method,
  CASE WHEN next_type = 'check_out' THEN next_basis         END AS check_out_basis,
  CASE WHEN next_type = 'check_out' THEN next_confirmed_by  END AS check_out_confirmed_by,
  CASE WHEN next_type = 'check_out' THEN next_confirmed_at  END AS check_out_confirmed_at,
  (next_type IS DISTINCT FROM 'check_out')                      AS is_open,
  CASE WHEN next_type = 'check_out'
       THEN (next_method = 'inferred') ELSE false END           AS is_estimated,
  CASE WHEN next_type = 'check_out'
       THEN (EXTRACT(EPOCH FROM (next_at - check_in_at)) / 60)::int END AS duration_minutes
FROM paired
WHERE type = 'check_in';
