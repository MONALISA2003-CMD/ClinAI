# ClinAI Intelligence Engine

Deterministic computation and analytical operations for ClinAI. This service is deliberately separate from generative text generation so arithmetic, statistics, dates, trends, forecasts and other numerical work can be independently tested and audited.

Endpoints:

- `GET /health`
- `POST /v1/compute`
- `POST /v1/dataset`

The API service calls this service through `INTELLIGENCE_SERVICE_URL`.
