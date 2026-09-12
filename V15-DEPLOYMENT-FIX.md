# ClinAI V15 Deployment Fix

Fixed the Vercel production build blocker in `apps/web/app/page.tsx`.

## Fix
The create-record submit handler now declares `url` and `body` outside the `try` block so the offline recovery path can safely enqueue the exact request after network failure.

The final module-specific URL and transformed request body are retained for offline sync.

## Verification
- V15 full-system audit: passed, 13 checks
- V14 integration audit: passed
- ZIP integrity: verified after packaging
