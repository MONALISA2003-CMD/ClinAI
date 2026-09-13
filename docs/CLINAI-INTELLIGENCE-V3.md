# ClinAI Intelligence V3 — NLP + ML + Python + Reasoning + Multilingual Safety

ClinAI V3 separates language understanding, deterministic analytics, governed ML review signals, evidence retrieval, cross-module reasoning, safety controls and natural-language presentation.

## Pipeline
1. Language input
2. NLP language/concept analysis
3. Language-specific safety policy
4. Tenant-scoped retrieval
5. Python deterministic calculations and longitudinal analytics
6. Governed ML review signals
7. Cross-module reasoning
8. Evidence/provenance
9. Safety gate
10. Natural-language response

## Language tiers
- English — full clinical intelligence
- Kiswahili — strong controlled clinical support
- Kinyarwanda — strong controlled clinical support
- Luganda — limited supervised clinical NLP
- Runyankore — very limited supervised support
- Alur — communication/translation only

Alur is hard-gated away from clinical reasoning unless the request is explicitly a translation task. Low-resource languages must not silently receive the same inference privileges as English.

## ML governance
The ML utility operates only on explicitly supplied datasets. It does not automatically learn from patient conversations. Production clinical models require governed data, de-identification, authorization/consent where applicable, provenance, clinical and linguistic validation, held-out evaluation, monitoring and human review.

## Safety boundary
ClinAI does not independently diagnose, prescribe, discharge, change medication, authorize payment or execute irreversible clinical decisions. Structured data may exist internally, but clinician-facing responses are rendered as professional natural language and never expose raw JSON or internal implementation details.
