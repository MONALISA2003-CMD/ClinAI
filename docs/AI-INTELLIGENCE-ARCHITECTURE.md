# ClinAI Intelligence Architecture

ClinAI Intelligence is implemented as an orchestration layer over the healthcare system rather than as a standalone chatbot.

## Intelligence flow

1. Understand the request.
2. Select the minimum sufficient evidence and tools.
3. Retrieve tenant-scoped patient, facility or operational records.
4. Use deterministic computation for arithmetic, clinical formulas, dates, rates and statistics.
5. Use the Python Intelligence Engine for multi-value analysis, trends, forecasts, comparisons and anomaly detection.
6. Use approved knowledge sources for governed guidance.
7. Optionally use Google Search and URL Context only for explicit research mode.
8. Reconcile evidence and uncertainty.
9. Produce structured output with a direct answer, recorded facts, calculations, reasoning summary, suggested review, uncertainty, evidence and confidence.
10. Persist an auditable AI work run.

The system deliberately does not expose private chain-of-thought. Users receive a concise reasoning summary instead.

## Implemented AI modes

- Quick: fast lookups and simple questions.
- Intelligence: cross-module healthcare context and proactive attention.
- Analytics: calculations, trends, forecasts, comparisons and anomalies.
- Research: external evidence and approved knowledge sources.

## Deterministic computation

The Python Intelligence Engine supports BMI, BSA, MAP, pulse pressure, shock index, anion gap, corrected calcium, corrected sodium, CKD-EPI 2021 eGFR, Cockcroft-Gault creatinine clearance, percentages, percent change, rates, collection rate, occupancy rate, age, gestational age, estimated due date, descriptive statistics, trends, linear forecasts, z-score anomalies, waiting time and stock days.

These operations are deliberately separated from generative text so their outputs can be tested independently.

## Proactive intelligence

The attention engine detects recorded signals including:

- unreleased critical laboratory results
- overdue follow-up
- critical and urgent care tasks
- referral delays
- prolonged queue waiting
- inventory at or below reorder level
- active facility incidents

These are signals for human review, not autonomous clinical decisions.

## Interoperability direction

ClinAI can persist decision-support results in an auditable internal model and is designed to map future clinical decision-support interactions to FHIR GuidanceResponse and related clinical reasoning resources. WHO SMART Guidelines provide a useful model for turning clinical guidance into computable, testable and interoperable digital content.

## Current Google Gemini integration

The API uses the current Gemini Interactions API and function calling. Structured JSON output is used so the frontend does not have to interpret uncontrolled Markdown. The Gemini API currently documents Interactions as the recommended interface for new applications and supports function calling, structured output, code execution and built-in tools.

For real clinical deployment, the exact Google service, data handling terms, regional controls, privacy agreements, regulatory position and approved healthcare use must be assessed before moving from development/demo use to production clinical use.

## Environment

- `GEMINI_AUTHORIZATION_KEY`: server-side Gemini authorization key.
- `GEMINI_MODEL`: default reasoning model.
- `GEMINI_FAST_MODEL`: fast model override.
- `GEMINI_REASONING_MODEL`: reasoning model override.
- `INTELLIGENCE_SERVICE_URL`: URL of the Python Intelligence Engine.
- `GEMINI_ENABLE_CODE_EXECUTION`: optional server-side Gemini Python execution for governed non-clinical analytical tasks.
