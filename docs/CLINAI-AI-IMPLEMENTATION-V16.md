# ClinAI Intelligence Engine V16

ClinAI V16 adds the first full AI operating layer using Google's current Gemini Interactions API. The backend uses the stable `v1` Interactions endpoint and sends the Gemini authorization key only from the server environment.

## Authentication

Use `GEMINI_AUTHORIZATION_KEY` for the current authorization-key approach. `GEMINI_API_KEY` is retained as a compatibility fallback. Never expose either variable through `NEXT_PUBLIC_*` variables or browser code.

## Model

`GEMINI_MODEL` defaults to `gemini-3.8-flash` and can be changed without a code rewrite.

## Implemented intelligence

1. Gemini backend gateway
2. AI provider abstraction boundary
3. Patient context engine
4. Organization context engine
5. Ask ClinAI
6. Patient Intelligence
7. Clinical Attention Engine
8. Evidence/why-oriented response format
9. Clinical documentation drafts
10. Role briefings
11. Laboratory context
12. Medication reconciliation context
13. Maternal context
14. Pediatric context
15. Immunization context
16. Referral context
17. Care-plan context
18. Care-task context
19. Inpatient/emergency context through the common clinical context layer
20. Command-center intelligence
21. Facility intelligence
22. Finance intelligence
23. Population/district intelligence through organization context and role briefing
24. Supply/operations intelligence through role briefing and contextual questions
25. Patient-friendly explanations through document generation
26. Handover/referral/discharge draft support
27. Data-quality questions through Ask ClinAI
28. AI audit/usage records
29. AI evaluation records
30. Knowledge-source registry
31. Prompt-version registry foundation
32. Safety instructions and human-review boundary
33. Tenant-scoped context queries
34. Server-side API key isolation
35. Model version/configuration tracking
36. Latency tracking
37. AI status endpoint
38. AI usage endpoint
39. AI evaluation endpoint
40. AI knowledge-source endpoints
41. AI patient workspace
42. Command Center Ask ClinAI entry point
43. Responsive mobile/tablet AI workspace
44. Offline-aware application remains intact; AI requests require connectivity
45. Multi-tenant organization scoping at context layer
46. No autonomous record mutation from AI
47. No autonomous prescribing/diagnosis/discharge/payment actions
48. Missing-data and uncertainty handling instructions
49. Replaceable model configuration
50. Upgrade path from early free-tier use to higher-capacity Google Cloud AI

## API surface

- `GET /api/ai/status`
- `GET /api/ai/usage`
- `GET /api/ai/knowledge`
- `POST /api/ai/knowledge`
- `POST /api/ai/assist`
- `POST /api/ai/patient-intelligence`
- `POST /api/ai/attention`
- `POST /api/ai/document`
- `POST /api/ai/role-briefing`
- `GET /api/ai/evaluations`
- `POST /api/ai/evaluations`

The existing patient, clinical, operational, financial, public-health and supply modules remain the source systems. Gemini interprets controlled context; it does not become the database.

## Clinical safety boundary

AI output is assistance for authorized users. Generated clinical documentation is a draft and requires human review before becoming part of the record. The system should not be represented as a certified medical device or autonomous clinical decision maker.
