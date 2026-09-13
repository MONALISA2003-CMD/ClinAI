# ClinAI Intelligence Engine

Deterministic computation and analytics for ClinAI. The service is deliberately separate from generative text generation so arithmetic, statistics, dates, trends, screening flags and other numerical work can be independently tested and audited.

Endpoints:

- `GET /health`
- `POST /v1/compute`
- `POST /v1/dataset`
- `POST /v1/screen`

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
