# ClinAI Free AI Runtime

ClinAI runtime inference is intentionally **free-tier only** in the current release. Paid and trial inference is not a fallback.

## Runtime architecture

1. Deterministic Python intelligence runs first for calculations, trend detection, safety review signals, workflow gaps and data-quality checks.
2. A free-model router selects from the configured Gemini, OpenRouter and Groq paths.
3. OpenRouter is the transport for the NVIDIA Nemotron free family and the other configured `:free` models.
4. Patient-level protected context is restricted to direct-provider models that are explicitly marked `patientDataEligible`. Public OpenRouter models remain blocked from protected patient context unless a synthetic/public policy explicitly allows the public test path.
5. Failed free-model requests can fall through to another eligible free provider. There is no paid fallback.
6. Free-model tool loops are disabled by default to prevent quota multiplication.

## Provider quota controls

Gemini rate limits are project-level and model-specific; Google documents limits in RPM, TPM and RPD and recommends checking the active values in AI Studio. The application therefore uses a conservative local cap that can be lowered through environment variables.

OpenRouter currently documents 50 requests/day on its Free plan; the application defaults to 45/day and 18 requests/minute to preserve safety headroom.

The database table `ai_free_quota_state` is provider-global and acts as the cross-instance reservation ledger. Each provider request is reserved before network transmission, so a fallback attempt cannot silently bypass the application's free-tier budget.

## Environment

```dotenv
CLINAI_FREE_ONLY_RUNTIME=true
GEMINI_FREE_TIER_MODE=true
GEMINI_FREE_DAILY_LIMIT=10
GEMINI_FREE_RPM_LIMIT=4
GEMINI_FREE_MIN_INTERVAL_MS=15000
GEMINI_FREE_CACHE_MS=300000
OPENROUTER_FREE_DAILY_LIMIT=45
OPENROUTER_FREE_RPM_LIMIT=18
OPENROUTER_FREE_MIN_INTERVAL_MS=3500
GROQ_FREE_DAILY_LIMIT=20
GROQ_FREE_RPM_LIMIT=4
GROQ_FREE_MIN_INTERVAL_MS=15000
CLINAI_FREE_TOOL_ROUNDS=0
```

These are application safety budgets, not guarantees of provider quota availability. The provider dashboard remains authoritative.

## Paid AI later

GPT Astra/OpenAI is intentionally outside the current ClinAI runtime. It can be added later as a separately governed paid tier without changing the deterministic-first architecture.
