# ClinAI V25 Deep Free-Model Routing

## Objective
Expand free-model availability without allowing model capability mismatch or sending patient clinical context to public/free model endpoints by default.

## Current provider keys
ClinAI uses the existing four provider credentials:
- `GEMINI_API_KEY` / `GEMINI_AUTHORIZATION_KEY`
- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`

No model-specific API key is required for OpenRouter models. One OpenRouter key is used with the selected model slug.

## Registered model count
The current free-only registry contains 16 entries:
- 1 Gemini entry
- 14 OpenRouter free/public entries, including the NVIDIA Nemotron family
- 1 Groq GPT-OSS 120B entry

The former Cerebras trial path has been removed from the runtime.

## Capability policy
`AIModel.modalities` is conservative and currently declares text/image/audio/video support. An explicit request capability is a hard constraint. If the candidate pool has zero compatible configured models, routing stops with `AI_CAPABILITY_UNAVAILABLE`; it never falls back to an incompatible text-only model.

Examples:
- image → image-capable model only
- audio → audio-capable model only
- video → video-capable model only
- multimodal → model with multimodal support
- agentic → model with both agentic role and tool calling

## Patient-data policy
Every model now carries `patientDataEligible`. All OpenRouter public/free entries are `false`. Inkling and Inkling Small are additionally `noPersonalData=true`. Direct providers remain separately classified.

For a patient-specific request, selection requires:
1. configured provider key
2. enabled model
3. `patientDataEligible=true`
4. `noPersonalData=false`
5. public endpoint is not used unless the deployment policy explicitly allows it

Public/free patient routing therefore fails closed rather than silently passing record-level clinical data to an ungoverned model.

## Public patient context
The legacy behavior of recursively redacting identifiers while still passing clinical records to public models has been removed. When the public-model flag is enabled, the public route receives a minimal workload descriptor and an explicit statement that patient records are withheld; diagnoses, medications, laboratory results, notes, IDs, contacts, dates and longitudinal records are not supplied through this path.

## Operational visibility
`GET /api/ai/providers` exposes:
- configured providers
- model availability
- `patientDataAvailable`
- strict capability routing status
- public patient-data setting

This prevents operators from confusing “model is configured” with “model is eligible for patient context.”

## Free-only runtime behavior
The runtime now hard-blocks non-free models, applies provider-global quota reservations before each network request, and uses deterministic Python reasoning before model inference.

## Existing AI behavior preserved
This change does not modify:
- AI system prompts
- model reasoning instructions
- Python clinical reasoning
- deterministic CDSS rules
- provider credentials
- Neon schema
- patient-context source of truth
- multilingual safety policy

## Verification
- Deep routing audit: passed
- V25 Gate 3 audit: passed
- V25 Gate 2 audit: passed
- V25 Gate 1 audit: passed
- Schema contract audit: passed
- TypeScript transpilation: 11 files, 0 syntax diagnostics
- Full dependency-backed `npm run build`: not executed locally because `npm install --no-audit --no-fund` exceeded the available network timeout; Render should run the authoritative build.
