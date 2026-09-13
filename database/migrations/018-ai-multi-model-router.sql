-- ClinAI multi-model intelligence registry and provider routing audit.
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
CREATE INDEX IF NOT EXISTS ai_provider_usage_created_idx ON ai_provider_usage(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ai_provider_usage_provider_idx ON ai_provider_usage(provider_key,model_key,created_at DESC);
