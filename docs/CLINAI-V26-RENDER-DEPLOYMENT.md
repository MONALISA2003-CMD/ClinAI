# ClinAI V26 — Render/Vercel Deployment Contract

## API service

Render service: `clinai-api`

Required environment variables already used by the project:

- `DATABASE_URL`
- `JWT_SECRET`
- `GEMINI_API_KEY` or `GEMINI_AUTHORIZATION_KEY`
- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `CEREBRAS_API_KEY`

Recommended reliability configuration:

- `CLINAI_MULTI_MODEL_MODE=true`
- `CLINAI_AI_FALLBACK_ATTEMPTS=5`
- `CLINAI_STRICT_CAPABILITY_ROUTING=true`
- `CLINAI_PROVIDER_TIMEOUT_MS=15000`
- `CLINAI_ALLOW_PUBLIC_AI_WITH_PATIENT_DATA=false`

The last setting should remain false unless a separate privacy/governance decision explicitly authorizes otherwise.

## Web service

Vercel must build the `apps/web` application with:

`NEXT_PUBLIC_API_URL=https://clinai-api.onrender.com`

The web application does not contain provider secrets. Provider credentials stay on the API service.

## Deployment sequence

1. Deploy the API source to Render and allow its normal dependency installation/build to complete.
2. Confirm `/health` is green.
3. Confirm `/api/build-info` returns V26/0.18.1 and the expected Render commit when called with an authenticated session if the route is protected by the deployment policy.
4. Deploy the web application to Vercel.
5. Open ClinAI, enter the authenticated workspace and allow the V26 service worker to activate.
6. Test AI with a non-patient operational question.
7. Test the 18 previously broken module workspaces.
8. Test a patient-specific AI question only with test/demo data.
9. Review Render logs for provider failures and fallback activity.

## Important

Do not reset the Neon database. V26 contains no destructive database migration.
