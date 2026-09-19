# ClinAI

ClinAI is a connected healthcare platform designed to bring patient care, clinical workflows, diagnostics, medication management, operations, finance, interoperability and clinical intelligence into one workspace. The platform is built around a shared clinical record and organization-scoped data so information can move with the patient across the care journey.

## What ClinAI provides

- Patient registration and longitudinal Patient 360 views
- Queue, triage, encounters, diagnoses, clinical notes and care plans
- Orders, laboratory, imaging and pharmacy workflows
- Nursing, emergency, inpatient, beds, surgery, maternity and pediatrics
- Immunization, child health, chronic care, medication reconciliation and consent management
- Referrals and referral transfers
- Billing, payments, insurance, claims and accounting
- Inventory, procurement and supplier workflows
- Patient portal, portal messaging, telemedicine and remote monitoring
- Notifications, documents and public-health surveillance workflows
- Facility, workforce, capacity, resource, incident and performance management
- Interoperability, health connections, terminology, guidelines, care pathways, reporting and offline synchronization
- Care Graph, care-gap review, clinical velocity, value-based measures and district intelligence
- ClinAI AI assistance, evaluations, governance, security and risk controls

The public testing workspace uses synthetic records. Production deployments must use approved data, credentials, access controls, governance and clinical processes appropriate to the deployment environment.

## Architecture

ClinAI is a monorepo with three primary application layers:

```text
ClinAI
├── apps/web/                  Next.js web application
├── services/api/              Fastify API and clinical application services
├── services/intelligence/     Python intelligence and analytics service
├── packages/                  Shared contracts and domain packages
├── database/                  PostgreSQL schema, migrations and synthetic data
├── tests/                     Automated integrity and regression checks
└── scripts/                   Build, deployment and audit utilities
```

### Web application

- Next.js 15
- React 19
- TypeScript
- Responsive clinical workspace UI for desktop and mobile
- Shared module navigation and connected record workflows

### API

- Node.js
- Fastify 5
- TypeScript
- Zod validation
- PostgreSQL access through `pg`
- JWT-based authenticated workflows
- Organization-scoped data access
- Clinical, operational, financial, interoperability and intelligence APIs

### Intelligence service

- Python
- FastAPI
- Pydantic
- NumPy
- SciPy
- scikit-learn
- Deterministic clinical and operational computation separated from the web/API layer

### Database

- PostgreSQL 18 compatible schema
- Neon PostgreSQL for the hosted database environment
- Organization-scoped clinical and operational records
- Explicit relationships between patients, encounters, clinical events and domain records
- Indexed retrieval paths for high-use clinical and intelligence queries

## AI and clinical intelligence

ClinAI treats AI as an assisted clinical information layer rather than an independent clinical authority. The intelligence architecture can assemble authorized patient and organization context, retrieve connected records, calculate deterministic measures, surface signals and care gaps, and provide assisted responses for human review.

Clinical decisions remain with qualified healthcare professionals and established clinical processes. Sensitive production deployments should use approved models, credentials, evidence sources, privacy controls, evaluation processes and governance appropriate to the organization.

The main AI services are located in:

- `services/api/src/ai/` for orchestration and provider integration
- `services/api/src/intelligence/` for server-side intelligence coordination
- `services/intelligence/` for Python analytics and deterministic computation
- `apps/web/app/components/` for the clinical intelligence user experience

## Data and interoperability

The data model is designed around connected healthcare records. Major relationships include:

```text
Patient
  ├── Encounters
  │     ├── Diagnoses
  │     ├── Clinical notes
  │     ├── Orders
  │     │     ├── Laboratory → Results
  │     │     └── Imaging → Reports
  │     ├── Medications
  │     └── Care plans / tasks / referrals
  ├── Admissions / beds / nursing / surgery / maternity / pediatrics
  ├── Immunization / chronic care / reconciliation / consent
  ├── Finance / insurance / claims / payments
  └── Intelligence signals / care gaps / Care Graph / Patient 360
```

FHIR-oriented resources, interoperability connections, terminology, reporting and offline synchronization are implemented as controlled integration boundaries. External national or facility systems are not assumed to be connected merely because an adapter or configuration exists.

## Security and governance

- Organization-scoped database queries
- Authenticated protected workflows
- Role-aware access boundaries
- Input validation with Zod
- Audit-oriented clinical and operational actions
- AI governance, evaluation and security records
- Synthetic public testing data kept separate from protected clinical workflows
- No AI credentials should be exposed to the browser

## Local development

### Requirements

- Node.js 20+
- npm 10+
- Python 3.11+ for the intelligence service
- PostgreSQL or a Neon PostgreSQL project

### Install

```bash
npm install
```

For the Python intelligence service:

```bash
python -m pip install -r services/intelligence/requirements.txt
```

### Environment

Configure the API and web environment variables for the deployment. Common settings include:

```text
DATABASE_URL
JWT_SECRET
NEXT_PUBLIC_API_URL
INTELLIGENCE_SERVICE_URL
```

AI provider credentials depend on the provider configuration enabled for the deployment. Keep all provider credentials server-side. Never commit secrets, `.env` files or production credentials to source control.

### Run

```bash
npm run dev
```

The web application and API can also be started independently with their workspace scripts.

## Database workflow

Database changes live under `database/`. The schema and migration history should be applied in their intended order. Never rename or reorder already-applied migration files in a live database deployment.

Synthetic test data is available for development and public testing. It should never be confused with real clinical records.

## Quality checks

The repository contains automated checks for:

- Frontend and backend route alignment
- Module contract integrity
- Database schema contracts
- Clinical workflow connectivity
- Intelligence and AI core behavior
- Security boundaries
- Public synthetic-data isolation
- Responsive UI structure
- Deployment layout and build artifacts
- Domain integrity and regression behavior

Run the main type checks with:

```bash
npm run typecheck
```

Run the broader stability suite with:

```bash
npm run test:all:stability
```

Individual audit scripts are available under `tests/` when a focused check is required.

## Deployment

The web application is suitable for a Next.js/Vercel deployment and the API is designed for a Node/Fastify service such as Render. The Python intelligence service can run as its own service. Neon provides the hosted PostgreSQL layer.

A production deployment should verify:

1. Web application build and type safety
2. API build and route registration
3. Database connectivity and migration state
4. Organization and role configuration
5. AI provider credentials and response latency
6. Intelligence service connectivity
7. Synthetic/public workspace isolation
8. Clinical workflow smoke tests across registration, care, diagnostics, medication, finance and intelligence
9. Monitoring, logs, backups and operational ownership

## Project journey

ClinAI has evolved from a connected clinical record foundation into a broader healthcare operating environment. The current architecture consolidates clinical care, diagnostics, medication workflows, acute and specialty services, finance, supply, patient engagement, facility operations, interoperability and intelligence around shared records. The implementation emphasizes incremental domain expansion, explicit data relationships, organization-level isolation, measurable operational workflows and human-reviewed AI assistance.

The repository intentionally keeps implementation history out of the user-facing product. The source code, database migration history and automated tests remain the authoritative technical record of how the platform is built.

## Production principles

- One connected clinical record rather than isolated module silos
- Explicit database relationships rather than presentation-only links
- Human clinical oversight for consequential decisions
- Honest handling of missing or unavailable information
- Organization-scoped access throughout the data layer
- Observable, testable backend workflows
- Mobile-first clinical usability without sacrificing desktop workflows
- Clear separation between public synthetic testing and protected healthcare data
