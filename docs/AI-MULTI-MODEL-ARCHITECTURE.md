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
`CLINAI_ALLOW_PUBLIC_AI_WITH_PATIENT_DATA=false` by default. OpenRouter public/free endpoints are treated as **non-clinical/public models** and are blocked from patient clinical context by default. The opt-in flag does not send record-level clinical context to public models; it only permits the public-model path for non-record-level workload handling. Direct-provider models remain subject to the deployment privacy policy and provider contractual review. OpenRouter states that provider data practices vary by provider and model, so model/provider policy must be reviewed before routing sensitive data. Groq states inference customer data is not retained by default and supports zero-data-retention controls; Cerebras states it does not retain inference inputs/outputs; these statements do not replace ClinAI governance or jurisdictional compliance review.

## Deterministic intelligence
PostgreSQL remains the source of truth. The Python Intelligence Engine remains responsible for calculations, statistics, trends, forecasting, anomaly detection, waiting-time and inventory calculations. AI interprets results rather than inventing arithmetic.

## Evaluation and audit
Provider selection, latency, failures, model identity, work runs and evaluations are retained in the AI audit layer when PostgreSQL is configured.

## Performance and free-tier operation
ClinAI uses a fast-first path for quick requests: minimal context, no evidence-registry preload, no tool rounds, reduced output budget, provider timeouts, short-lived context caching, and multi-provider fallback. Full context is reserved for intelligence/research modes. Public/free providers remain blocked from patient-specific tool results unless explicitly enabled by governance configuration.


## Capability routing
ClinAI now enforces hard capability routing. When a request explicitly requires `image`, `audio`, `video`, `multimodal`, `agentic`, `medical`, `coding`, `research`, or `fast`, a model that does not declare that capability is never selected as a fallback. If no configured model supports the requested capability under the current patient-data policy, the request fails closed with `AI_CAPABILITY_UNAVAILABLE` instead of silently downgrading to an incompatible model. This specifically prevents a text-only GPT-OSS endpoint such as Cerebras from being selected for a multimodal request.

## Patient-data model policy
The model registry now carries `patientDataEligible` and conservative `modalities` metadata. All 14 OpenRouter free/public entries are explicitly marked `patientDataEligible=false`. Inkling and Inkling Small are additionally marked `noPersonalData=true`. The `/api/ai/providers` endpoint exposes `patientDataAvailable` separately from simple provider availability so operational tooling can distinguish “configured” from “safe for patient-context routing.”

## Fast path
Quick requests skip full patient/facility and evidence preloading, use a compact context, avoid reasoning overhead, use a small output budget, and apply a 9-second provider timeout. Short-lived context/request caches reduce repeated database and model work. Non-Gemini free providers may use one tool continuation for non-patient requests; Gemini remains quota-protected and tool loops remain governed separately.
