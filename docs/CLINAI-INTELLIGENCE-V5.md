# ClinAI Intelligence V5 — Response Boundary, Speed and Multilingual Safety

## Purpose
V5 closes the clinician-facing AI response boundary so provider/model structured output is never rendered as raw JSON. Structured data remains internal for audit, evidence, calculations and safety.

## Response contract
All clinician/public assistant entry points normalize provider output through the same response boundary and return a natural-language `answer` string. The UI has a second defensive normalization layer. Raw fields such as `directAnswer`, `recordedFacts`, `reasoningSummary`, `suggestedReview`, `evidence`, provider metadata and response schemas are not clinician-visible.

## Speed architecture
Simple requests use deterministic fast paths where possible. More complex requests use model routing and only invoke deeper reasoning when needed. Independent language/context work is overlapped where possible, provider timeouts are bounded, and frontend request timeouts vary by mode.

## Multilingual behavior
The same response boundary is applied regardless of language. English, Kiswahili, Kinyarwanda, Luganda and Runyankore retain their controlled language tiers; Alur remains translation/communication-only for clinical use. Ambiguous low-resource language input must be clarified rather than guessed.

## Clinical safety
V5 does not authorize autonomous diagnosis, prescribing, medication changes, discharge, payment authorization or irreversible clinical decisions. Python and ML outputs are review signals/analytical results, not autonomous clinical decisions.
