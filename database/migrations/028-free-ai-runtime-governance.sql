-- ClinAI free-only runtime quota governance.
-- This table is provider-global because Gemini/API project quotas and OpenRouter free-tier quotas
-- are not tenant-specific. No paid provider is represented here.
CREATE TABLE IF NOT EXISTS ai_free_quota_state (
  provider_key text PRIMARY KEY,
  daily_limit integer NOT NULL CHECK (daily_limit >= 0),
  daily_used integer NOT NULL DEFAULT 0 CHECK (daily_used >= 0),
  day_started_at timestamptz NOT NULL DEFAULT now(),
  minute_limit integer NOT NULL CHECK (minute_limit >= 0),
  minute_used integer NOT NULL DEFAULT 0 CHECK (minute_used >= 0),
  minute_started_at timestamptz NOT NULL DEFAULT now(),
  last_request_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_free_quota_state_updated_idx ON ai_free_quota_state(updated_at DESC);

-- Retire the historical Astra runtime capability. It remains as a draft for a future paid tier.
UPDATE ai_capabilities
SET status = 'draft',
    model_policy = jsonb_build_object(
      'runtime','free-only',
      'deterministicFirst',true,
      'paidRuntimeDisabled',true,
      'futurePaidModelProfile','gpt-6-astra',
      'humanReviewRequired',true
    ),
    updated_at = now()
WHERE capability_id = 'astra-clinical-intelligence';
