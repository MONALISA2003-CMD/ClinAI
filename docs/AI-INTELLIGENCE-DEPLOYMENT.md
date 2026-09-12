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
