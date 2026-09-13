# ClinAI Intelligence Engine

Deterministic computation, analytics, machine-learning utilities and clinical review reasoning for ClinAI. The service is deliberately separate from generative text generation so arithmetic, statistics, dates, trends, screening flags and other numerical work can be independently tested and audited.

Endpoints:

- `GET /health`
- `POST /v1/compute`
- `POST /v1/dataset`
- `POST /v1/screen`
- `POST /v1/clinical/reason`

Additional compute operations include:

- `delta`
- `rolling_mean`
- `ewma`
- `reference_range_flags`
- `fluid_balance`
- `urine_output_rate`
- `time_to_event_minutes`
- `coefficient_of_variation`
- `correlation`
- `batch`

The API service calls this service through `INTELLIGENCE_SERVICE_URL`.


Clinical reasoning is deterministic and review-gated. It identifies explicit critical/abnormal results, conservative vital-sign review signals, medication/allergy name overlaps, unresolved orders, delayed referrals, overdue follow-up, priority tasks, longitudinal changes and data-quality limitations. It does not diagnose, prescribe, triage autonomously or make irreversible decisions.

The Python service is intentionally separated from generative language models. FastAPI provides the production HTTP boundary, while NumPy/SciPy/scikit-learn are available for auditable numerical and non-diagnostic machine-learning workloads.
