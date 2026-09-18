# ClinAI Multi-Model Intelligence

ClinAI now uses a provider-independent AI router instead of depending on one model.

## Model pool
The current runtime has 16 explicitly free model entries:
- 1 Gemini direct-provider model
- 14 OpenRouter `:free` models, including the NVIDIA Nemotron family
- 1 Groq-hosted GPT-OSS model

The former Cerebras trial model is no longer a runtime provider. Paid/trial runtime inference is blocked.

The free endpoints are rate limited and availability can change. ClinAI uses an application-level quota ledger and falls back only to another eligible free provider.

## Tool orchestration
OpenAI-compatible free providers use the same ClinAI tool gateway used by Gemini. Tool continuations are disabled by default with `CLINAI_FREE_TOOL_ROUNDS=0` so one user request does not multiply free-tier usage.

## Healthcare data boundary
`CLINAI_ALLOW_PUBLIC_AI_WITH_PATIENT_DATA=false` by default. OpenRouter public/free endpoints are treated as **non-clinical/public models** and are blocked from patient clinical context by default. The opt-in flag does not send record-level clinical context to public models; it only permits the public-model path for non-record-level workload handling. Direct-provider models remain subject to the deployment privacy policy and provider contractual review. OpenRouter states that provider data practices vary by provider and model, so model/provider policy must be reviewed before routing sensitive data. Groq remains a direct-provider free path for approved patient-context requests. Provider data practices still require ClinAI governance and jurisdictional review.

## Deterministic intelligence
PostgreSQL remains the source of truth. The Python Intelligence Engine remains responsible for calculations, statistics, trends, forecasting, anomaly detection, waiting-time and inventory calculations. AI interprets results rather than inventing arithmetic.

## Evaluation and audit
Provider selection, latency, failures, model identity, work runs and evaluations are retained in the AI audit layer when PostgreSQL is configured.

## Performance and free-tier operation
ClinAI uses a fast-first path for quick requests: minimal context, no evidence-registry preload, no tool rounds, reduced output budget, provider timeouts, short-lived context caching, and multi-provider fallback. Full context is reserved for intelligence/research modes. Public/free providers remain blocked from patient-specific tool results unless explicitly enabled by governance configuration.


## Capability routing
ClinAI now enforces hard capability routing. When a request explicitly requires `image`, `audio`, `video`, `multimodal`, `agentic`, `medical`, `coding`, `research`, or `fast`, a model that does not declare that capability is never selected as a fallback. If no configured model supports the requested capability under the current patient-data policy, the request fails closed with `AI_CAPABILITY_UNAVAILABLE` instead of silently downgrading to an incompatible model. This prevents a text-only provider from being selected for a multimodal request.

## Patient-data model policy
The model registry now carries `patientDataEligible` and conservative `modalities` metadata. All 14 OpenRouter free/public entries are explicitly marked `patientDataEligible=false`. Inkling and Inkling Small are additionally marked `noPersonalData=true`. The `/api/ai/providers` endpoint exposes `patientDataAvailable` separately from simple provider availability so operational tooling can distinguish “configured” from “safe for patient-context routing.”

## Fast path
Quick requests skip full patient/facility and evidence preloading, use a compact context, avoid reasoning overhead, use a small output budget, and apply a 9-second provider timeout. Short-lived context/request caches reduce repeated database and model work. Free providers use zero tool continuations by default; Gemini and OpenRouter/Groq calls are governed by the shared free-tier quota layer.
