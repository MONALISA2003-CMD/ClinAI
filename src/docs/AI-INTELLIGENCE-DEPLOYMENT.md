# ClinAI Intelligence Deployment

## Python Intelligence Engine

Create a Render Web Service for `services/intelligence`.

- Runtime: Docker
- Root Directory: `services/intelligence`
- Dockerfile: `services/intelligence/Dockerfile`
- Health check: `/health`
- Region: Frankfurt, matching the ClinAI API

After deployment, copy the service URL and add it to the existing `clinai-api` environment:

`INTELLIGENCE_SERVICE_URL=https://<your-intelligence-service>.onrender.com`

Restart/redeploy `clinai-api` after saving the environment variable.

## Existing API environment

Keep the Gemini key only on the server:

`GEMINI_AUTHORIZATION_KEY=<your-AQ-authorization-key>`

Recommended model settings:

`GEMINI_MODEL=gemini-3.8-flash`

`GEMINI_FAST_MODEL=gemini-3.8-flash`

`GEMINI_REASONING_MODEL=gemini-3.8-flash`

`GEMINI_ENABLE_CODE_EXECUTION=false`

The Python Intelligence Engine does not receive the Gemini key and does not call the model. It performs deterministic computation and analytics only.

## Production clinical AI boundary

The current Gemini API Additional Terms state that the Gemini API may not be used in clinical practice or to provide medical advice. They also state that unpaid Gemini services should not receive sensitive, confidential or personal information. This package therefore treats the direct Gemini API path as a development/demo integration and keeps the clinical deployment boundary explicit. Before exposing real patient data or clinical decision support to production users, re-qualify the model provider path under an appropriate Google Cloud healthcare/enterprise arrangement and complete privacy, contractual, regulatory and clinical validation.

## Gemini request and function-calling behavior

ClinAI uses the Gemini Interactions API in **stateless mode** (`store=false`) for the current integration. Each tool continuation resends the exact interaction history, including the original user input, every model-generated step, and the matching function results. This is intentional: Google documents that `store=false` cannot be combined with `previous_interaction_id`, and stateless function calling requires the full history to be preserved.

### Free-tier mode

For a Free Tier project, keep:

`GEMINI_FREE_TIER_MODE=true`

This changes the AI gateway to a quota-safe single-call strategy:

- one Gemini request maximum per user interaction
- no Gemini function-calling continuation loops
- no Gemini Search/URL Context/code-execution tools
- patient and facility context is assembled by ClinAI before the model call
- deterministic calculations can still run through the separate Python Intelligence Engine
- identical recent requests are served from a short-lived server cache
- requests are spaced to reduce burst traffic
- a local daily safety budget defaults to 4 requests, leaving a margin below the 5-request quota shown by the current free-tier error
- a clear 429 message is returned when Google's project quota is actually exhausted

`GEMINI_FREE_DAILY_LIMIT=4`
`GEMINI_FREE_MIN_INTERVAL_MS=15000`
`GEMINI_FREE_CACHE_MS=300000`

The local budget is deliberately conservative. It does not increase Google's quota; it prevents ClinAI from intentionally spending the entire visible quota and reduces accidental repeated requests. Google controls the actual project quota and reset window. Current Google pricing documentation confirms that Free Tier has limited model/tool access and that higher production limits are available on Paid Tier.

When you later move to a paid, governed deployment, set `GEMINI_FREE_TIER_MODE=false` to restore tool-using orchestration and use `GEMINI_MAX_TOOL_ROUNDS` as the continuation guard.
