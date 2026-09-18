ClinAI Workstream 5 implementation manifest

This archive contains the ClinAI source snapshot after the Workstream 5 free-only AI runtime hardening.

Implemented:
- free-only runtime model registry with 16 models
- 14 existing OpenRouter free models, including the NVIDIA Nemotron family
- existing Gemini free path retained
- existing Groq GPT-OSS free path retained
- Cerebras trial runtime provider removed
- paid OpenAI/GPT Astra runtime execution disabled and kept only as future governance metadata
- Python deterministic-first clinical reasoning expanded with duplicate medication detection, missed/no-show appointment patterns and laboratory trend detection
- hard free-only model-selection and network-call gate
- provider-global free quota reservation ledger in Neon
- Gemini, OpenRouter and Groq application safety budgets with conservative headroom
- cross-instance quota reservations using ai_free_quota_state
- zero free-tier tool continuations
- Gemini code execution disabled in the free-only runtime
- deterministic-first routing and free-provider fallback only
- OpenRouter public/free models remain blocked from protected patient clinical context by default
- synthetic/public patient testing remains explicitly marked as synthetic
- free AI status and quota visibility exposed through existing AI status endpoints
- updated runtime, deployment and AI architecture documentation
- regression and free-tier audits updated and passing
- Python deterministic intelligence audit added

Live Neon verification was performed against the existing project/branch without resetting or truncating the database.

Live free-quota safety rows:
- Gemini: 10/day, 4/minute
- OpenRouter: 45/day, 18/minute
- Groq: 20/day, 4/minute

Live governance verification:
- astra-clinical-intelligence is draft, free-only and paid runtime disabled
- active paid/trial capability count is 0
- free quota usage is currently 0

Build note:
- Full TypeScript build was not claimable in this environment because dependency installation timed out and node type definitions were unavailable locally.
- Source-level, Python, route and AI regression audits passed.
