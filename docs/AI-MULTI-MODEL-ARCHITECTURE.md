# ClinAI Multi-Model Intelligence

ClinAI now uses a provider-independent AI router instead of depending on one model.

## Model pool
- Gemini 3.8 Flash
- NVIDIA Nemotron 3 Ultra (OpenRouter free endpoint)
- NVIDIA Nemotron 3 Super (OpenRouter free endpoint)
- Ling 3.0 Flash Sante (OpenRouter free endpoint)
- Thinking Machines Inkling (OpenRouter free endpoint)
- MiniMax M3 (OpenRouter free endpoint)
- Nex N2.5 Mini (OpenRouter free endpoint)
- OpenAI GPT OSS 120B through Groq
- GPT OSS 120B through Cerebras free trial

The free endpoints are rate limited and availability can change. The router therefore discovers configured providers at runtime and falls back to another configured provider after provider errors.

## Tool orchestration
OpenAI-compatible providers can use the same ClinAI tool gateway used by Gemini. Tool loops are limited by `CLINAI_OPENAI_TOOL_ROUNDS` to avoid runaway free-tier usage.

## Healthcare data boundary
`CLINAI_ALLOW_PUBLIC_AI_WITH_PATIENT_DATA=false` by default. Public/free endpoints are not treated as governed clinical processors. Patient-specific context is redacted for public-model routing, and provider tools are disabled for those requests unless the setting is explicitly enabled by the deployment owner after a legal/privacy/security review.

## Deterministic intelligence
PostgreSQL remains the source of truth. The Python Intelligence Engine remains responsible for calculations, statistics, trends, forecasting, anomaly detection, waiting-time and inventory calculations. AI interprets results rather than inventing arithmetic.

## Evaluation and audit
Provider selection, latency, failures, model identity, work runs and evaluations are retained in the AI audit layer when PostgreSQL is configured.

## Performance and free-tier operation
ClinAI uses a fast-first path for quick requests: minimal context, no evidence-registry preload, no tool rounds, reduced output budget, provider timeouts, short-lived context caching, and multi-provider fallback. Full context is reserved for intelligence/research modes. Public/free providers remain blocked from patient-specific tool results unless explicitly enabled by governance configuration.


## Fast path
Quick requests skip full patient/facility and evidence preloading, use a compact context, avoid reasoning overhead, use a small output budget, and apply a 9-second provider timeout. Short-lived context/request caches reduce repeated database and model work. Non-Gemini free providers may use one tool continuation for non-patient requests; Gemini remains quota-protected and tool loops remain governed separately.
