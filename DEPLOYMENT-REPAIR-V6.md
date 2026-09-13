# ClinAI V6 — deployment repair

## Repository layout

This package is intentionally flattened so the repository root itself is the ClinAI workspace:

- `package.json`
- `apps/web`
- `services/api`
- `services/intelligence`
- `services/ai`
- `packages`
- `database`

Do **not** commit the containing ZIP directory (`clinai-v6/src/...`) as an extra wrapper level.

## Vercel

Connect the GitHub repository at its repository root. The Vercel **Root Directory must be empty / repository root**. Do not set it to `api`, `services/api`, `src`, or another nested path.

The checked-in `vercel.json` then runs:

- Install: `npm install --no-audit --no-fund --progress=false`
- Build: `npm run build:web`
- Next output: `apps/web/.next`

If the Vercel project still has a saved Root Directory such as `api`, change it in Project Settings before redeploying. A repository-level `vercel.json` cannot override an incorrect project Root Directory.

## Render API

For the existing `clinai-api` service:

- Repository: the ClinAI GitHub repository
- Branch: `main`
- Root Directory: `services/api`
- Runtime: Node
- Build Command: `npm install --no-audit --no-fund && npm run build`
- Start Command: `npm start`
- Health Check Path: `/health`

The `services/api/package.json` is intentionally self-contained, so this service does not require the repository root as its Render working directory.

## Render Python intelligence

- Root Directory: `services/intelligence`
- Runtime: Docker
- Dockerfile Path: `Dockerfile`
- Health Check Path: `/health`

When Root Directory is set, Render resolves the Dockerfile and commands relative to that directory.

## Render AI boundary service

- Root Directory: `services/ai`
- Runtime: Docker
- Dockerfile Path: `Dockerfile`
- Health Check Path: `/health`

## Secrets

Do not commit secrets. Set `DATABASE_URL`, model API keys, JWT secrets, and other deployment secrets in the hosting provider's environment-variable settings.

## Important: Render cold starts

The free Render instance can sleep after inactivity. A cold start can therefore add substantial latency before the first request. Code optimization cannot remove provider-level cold-start latency. For consistently fast clinical use, keep the API service on an always-on plan or otherwise use infrastructure that does not suspend the API.

## Deployment order

1. Push this repository layout to GitHub.
2. Fix Vercel Root Directory to repository root.
3. Deploy Vercel and verify the Next build completes.
4. Fix Render `clinai-api` Root Directory to `services/api`.
5. Verify Render API `/health` is healthy.
6. Verify the intelligence engine `/health` if it is deployed separately.
7. Verify `NEXT_PUBLIC_API_URL` points to the healthy API.
8. Test `/api/ai/assist` in the live application.
9. Test English, Kiswahili, Kinyarwanda, Luganda and Runyankore response rendering.
10. Test simple fast-path questions before complex reasoning.

## No database reset

This deployment repair does not drop, truncate, reset, or recreate the Neon database.
