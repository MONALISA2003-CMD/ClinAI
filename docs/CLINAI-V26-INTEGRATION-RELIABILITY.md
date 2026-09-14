# ClinAI V26 — Integration + AI Reliability Repair

## Purpose

V26 repairs the production-facing contract between the ClinAI web workspace, the Fastify API, existing clinical domain tables, and the protected multi-model AI Router.

## Module contract repair

The frontend contains 73 workspace modules. Previously, the generic loader requested `/api/<module>` for modules that already had specialized backend routes or domain tables under different paths. This produced `Module not found` even when the data layer existed.

V26 adds explicit frontend read contracts and additive backend collection endpoints for:

- referral transfers
- care tasks
- child health
- medication reconciliation
- consents
- portal messages
- surveillance
- investigations
- response
- mortality
- district intelligence
- facility capacity
- facility resources
- facility incidents
- facility performance
- referral network
- AI evaluations
- care graph

The implementation reuses existing tables and specialized workflows. It does not reset, truncate, drop or delete production data.

Some operational/governance workspaces are intentionally read-only in the generic workspace when their existing write path is a specialized workflow. This prevents the UI from fabricating generic `module_records` for a domain that already has a canonical source.

## AI authentication repair

The API no longer exposes Fastify's raw missing-Authorization error. Authentication failures return a safe ClinAI session message.

The web client persists the demo/session token for the current browser session and retries the AI request once after refreshing the demo session when the API returns 401.

## AI reliability repair

A model is not considered successful merely because the provider returned HTTP 200.

V26 treats the following as provider failure and continues through the configured fallback chain:

- timeout
- network failure
- provider rejection
- empty content
- tool-only terminal response
- empty structured `directAnswer`
- generic incomplete answer
- malformed/unusable final answer

The existing multi-model router remains the selection authority.

## Provider request contract

OpenAI-compatible providers remain separated from the Gemini native path. Tool rounds do not combine tools with strict structured-output response formatting. Final rounds can use the structured response schema when the selected provider/model supports it.

Cerebras GPT-OSS 120B retains its provider-specific reasoning effort setting.

## Capability routing

Explicit image/audio/video/multimodal/agentic/medical/coding/research/fast requirements remain hard routing constraints. ClinAI does not silently send a request to an incompatible model.

Capability metadata does not itself create an attachment transport. End-to-end multimodal input remains a separate transport concern and must be wired before presenting upload capabilities to clinicians.

## Data policy

The current free/public OpenRouter entries remain blocked from patient-specific clinical context by default. The direct provider models remain the patient-data-eligible pool according to the existing router policy.

V26 does not weaken this boundary.

## Service worker

The web service worker cache is versioned to V26 and old ClinAI shell caches are removed during activation. This reduces stale frontend deployments after a Vercel release.

## Verification

Passed:

- V26 module contract audit
- V26 AI reliability audit
- V25 Gate 1 event coverage audit
- V25 Gate 2 clinical context audit
- V25 Gate 3 CDSS gateway audit
- schema contract audit
- TypeScript source transpilation for API and web
- JavaScript syntax checks for new tests

The dependency-backed `tsc -p` and Next.js production build could not be run in this environment because npm registry installation timed out. The project should therefore be deployed only after the platform build passes its normal dependency installation and production build.
