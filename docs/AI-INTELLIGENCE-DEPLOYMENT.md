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

The API also limits tool continuation rounds with `GEMINI_MAX_TOOL_ROUNDS` (default `2`). This prevents one complex question from consuming an excessive number of Gemini requests on a free-tier project.

A single AI question can still make more than one Gemini request when tools are needed. Google rate limits are applied per project and can be enforced by requests per minute, tokens per minute, or requests per day. If the project reaches a quota, ClinAI now returns a clear usage-limit message instead of exposing the raw provider error.
