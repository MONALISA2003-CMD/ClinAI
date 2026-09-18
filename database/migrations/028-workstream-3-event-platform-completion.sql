-- Workstream 3 event platform completion.
-- Additive and idempotent. No destructive operations.

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS causation_id uuid,
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_event_key_uidx
  ON outbox_events(event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbox_events_pending_ready_idx
  ON outbox_events(status, available_at, created_at)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS outbox_events_processing_idx
  ON outbox_events(status, locked_at)
  WHERE status='processing';
CREATE INDEX IF NOT EXISTS outbox_events_org_created_idx
  ON outbox_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outbox_events_correlation_idx
  ON outbox_events(organization_id, correlation_id, created_at DESC)
  WHERE correlation_id IS NOT NULL;

ALTER TABLE clinical_workflow_events
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS causation_id uuid,
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS clinical_workflow_correlation_idx
  ON clinical_workflow_events(organization_id, correlation_id, created_at DESC)
  WHERE correlation_id IS NOT NULL;

COMMENT ON COLUMN outbox_events.event_key IS 'Stable idempotency key for one domain event publication.';
COMMENT ON COLUMN outbox_events.correlation_id IS 'Correlation identifier shared by one business workflow.';
COMMENT ON COLUMN outbox_events.causation_id IS 'Upstream event identifier that caused this event.';
COMMENT ON COLUMN outbox_events.schema_version IS 'Version of the event payload contract.';
COMMENT ON COLUMN outbox_events.max_attempts IS 'Maximum automatic processing attempts before dead-lettering.';
COMMENT ON COLUMN outbox_events.dead_lettered_at IS 'Timestamp when automatic event processing was stopped.';
