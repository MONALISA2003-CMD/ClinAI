# Render API Build Failure — 2026-10-11

## Incident summary

Render service `clinai-api` (`srv-daicrqlg1s2s73eqklm0`) failed to build commit `52d3bd1354e31e8af0ed821e133f6f81c6f0e53e` on `main` at 2026-10-11 05:09 UTC (08:09 GMT+3). Build command:

```sh
npm install --no-audit --no-fund && npm run build:api
```

The compiler reported one error:

```text
src/main.ts(651,19): error TS2339: Property 'organizationId' does not exist on type 'string | object | Buffer<ArrayBufferLike>'.
```

## Root cause

The global `preHandler` awaited `req.jwtVerify()` and then read `req.user?.organizationId` directly. In the Fastify JWT type surface used by this API, `req.user` is typed as a decoded payload union (`string | object | Buffer`), so TypeScript correctly refuses direct property access without narrowing. This is a compile-time type-safety failure, not evidence of a bad Render region, memory limit, start command, health check, or database failure.

The API package build command runs `tsc -p tsconfig.json` first; therefore the build-artifact audit and runtime start are never reached for the failed commit.

## Fix prepared in this source package

The pre-handler now narrows `req.user` structurally to a non-null object, excludes Buffer, checks for the `organizationId` property, and validates that the claim is a non-empty string before allowing the request to proceed. Malformed/missing tenant claims still fail closed with `403 ORGANIZATION_CONTEXT_REQUIRED`. Clinical write authorization remains after this guard.

A dependency-free regression test is included at `tests/render-jwt-claims-type-audit.mjs`.

## Render history observed during investigation

- Service: `clinai-api`, branch `main`, auto-deploy on commit enabled, root directory `.`.
- Node.js: Render selected `24.14.1`.
- Last successful deployment before the failing commit: `586b7c656ade59bb1b64765e3884347fe098ddf4` (status `live` in Render at inspection time).
- Failing deployment: `52d3bd1354e31e8af0ed821e133f6f81c6f0e53e` (status `build_failed`, exited with status 2).
- Render events show the previous deployment succeeded and the latest one failed during the TypeScript compile step. This indicates Render retained the previous live deployment; the failed source was not promoted.

The Vercel green status is not contradictory: Vercel and Render build different deployment targets/configurations. Vercel's status does not typecheck the Render API workspace as configured on Render.

## Verification and limitations

- Root-cause commit and Render build logs inspected through connected GitHub and Render tools.
- Regression test covers the structural claim-narrowing guard and fails if the unsafe direct property access returns.
- The complete API TypeScript build could not be executed inside this packaging environment because dependencies are not installed and `npm install` timed out. Render is the authoritative environment for verifying its exact dependency resolution.
- The source patch was prepared in this package. A repository write/push did not complete in this session; the live `main` branch and Render deployment state must be rechecked after this patch is applied upstream.

## Follow-up checks after the patch is pushed

1. Confirm Render starts a new deployment for the patch commit.
2. Verify `npm run build:api` reaches `API_BUILD_ARTIFACT_PASS` and the deploy state becomes `live`.
3. Verify `/health` and `/api/build-info` for the deployed API.
4. Check runtime logs for startup/configuration failures after TypeScript compilation succeeds.
5. Validate the frontend's configured API origin matches the currently live API.

No environment variables, database schemas, domains, or deployment settings were changed as part of this diagnosis.
