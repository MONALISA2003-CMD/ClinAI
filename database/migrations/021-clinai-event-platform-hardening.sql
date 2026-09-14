-- ClinAI Event Platform Hardening v21
-- Additive only. No DROP/TRUNCATE/DELETE and no existing-row rewrites.

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_event_key_uidx
  ON outbox_events(event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events(status, available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS outbox_events_org_type_idx
  ON outbox_events(organization_id, event_type, created_at DESC);

COMMENT ON COLUMN outbox_events.event_key IS 'Stable idempotency key for one domain event publication.';
COMMENT ON COLUMN outbox_events.last_error IS 'Latest non-sensitive worker failure summary.';
COMMENT ON COLUMN outbox_events.locked_at IS 'Timestamp when a worker claimed the event.';
COMMENT ON COLUMN outbox_events.worker_id IS 'Opaque worker identifier that claimed the event.';
