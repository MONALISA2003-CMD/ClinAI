-- ClinAI Phase 1 backend correctness hardening.
-- Additive only: no DROP/TRUNCATE/DELETE and no existing-row rewrites.

-- Restore the provider-routing audit tables expected by the current AI orchestrator.
CREATE TABLE IF NOT EXISTS ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  governance_class text NOT NULL DEFAULT 'public-free',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, provider_key)
);
CREATE TABLE IF NOT EXISTS ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_key text NOT NULL,
  display_name text NOT NULL,
  capability_profile jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, model_key)
);
CREATE TABLE IF NOT EXISTS ai_provider_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  model_key text NOT NULL,
  status text NOT NULL,
  http_status integer,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_provider_usage_created_idx
  ON ai_provider_usage(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_provider_usage_provider_idx
  ON ai_provider_usage(provider_key, model_key, created_at DESC);

-- The active runtime records AI work in ai_work_runs. Keep the existing view contract,
-- but make its orchestration counters reflect the current runtime instead of the legacy
-- ai_orchestration_runs table alone.
CREATE OR REPLACE VIEW clinai_workstream5_intelligence_coverage AS
SELECT
  o.id AS organization_id,
  COALESCE(f.finding_count, 0)::integer AS intelligence_findings,
  COALESCE(c.context_audit_count, 0)::integer AS context_audits,
  COALESCE(w.run_count, 0)::integer AS orchestration_runs,
  COALESCE(w.completed_runs, 0)::integer AS completed_orchestration_runs,
  COALESCE(w.failed_runs, 0)::integer AS failed_orchestration_runs,
  COALESCE(w.human_review_runs, 0)::integer AS human_review_runs,
  COALESCE(s.security_events, 0)::integer AS security_events
FROM organizations o
LEFT JOIN (
  SELECT organization_id, count(*) AS finding_count
  FROM ai_intelligence_findings
  GROUP BY organization_id
) f ON f.organization_id = o.id
LEFT JOIN (
  SELECT organization_id, count(*) AS context_audit_count
  FROM ai_context_audits
  GROUP BY organization_id
) c ON c.organization_id = o.id
LEFT JOIN (
  SELECT
    organization_id,
    count(*) AS run_count,
    count(*) FILTER (WHERE status='completed') AS completed_runs,
    count(*) FILTER (WHERE status='failed') AS failed_runs,
    count(*) FILTER (
      WHERE COALESCE(result_summary->>'humanReviewRequired','false')='true'
    ) AS human_review_runs
  FROM ai_work_runs
  GROUP BY organization_id
) w ON w.organization_id = o.id
LEFT JOIN (
  SELECT organization_id, count(*) AS security_events
  FROM ai_security_events
  WHERE created_at >= now() - interval '30 days'
  GROUP BY organization_id
) s ON s.organization_id = o.id;

-- Make the runtime outbox worker's dead-letter semantics indexable without changing rows.
CREATE INDEX IF NOT EXISTS outbox_events_dead_letter_idx
  ON outbox_events(organization_id, dead_lettered_at DESC)
  WHERE dead_lettered_at IS NOT NULL;
