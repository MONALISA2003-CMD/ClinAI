# ClinAI Vercel Repair V7

## Scope
Vercel web build only. Render API build/runtime configuration is intentionally unchanged.

## Fixed
- Normalized optional contract field labels in `apps/web/app/page.tsx` before use.
- Removed unsafe direct calls to `f.label.toLowerCase()` and `placeholder={...||f.label}` in the create-record form.
- Preserved strict type narrowing for optional `createEndpoint` values.
- Added a focused Vercel web type-safety preflight audit.
- Vercel now runs the preflight before `next build`.

## Render preservation
No Render API source, API tsconfig, API package start/build script, domain package boundary, Render Blueprint, or API output layout was changed in this repair.

## Current Vercel warning
Vercel reports that the lockfile is missing SWC optional dependencies and that `esbuild` has a pending install script. These are dependency reproducibility warnings, not the current TypeScript failure. No registry-dependent lockfile was fabricated in the offline repair environment.

## Verification
- 80 module contracts inspected.
- 322 contract fields inspected; 0 missing labels in the canonical catalog.
- Vercel web type-safety preflight: PASS.
- page.tsx TypeScript transpilation: PASS, 0 diagnostics.
