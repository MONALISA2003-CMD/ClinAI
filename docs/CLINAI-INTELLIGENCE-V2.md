# ClinAI Intelligence V2

This release adds a deterministic clinical-intelligence layer without replacing the existing AI provider architecture.

## Clinical intelligence

- Cross-module patient context across encounters, observations, diagnoses, orders, laboratory, imaging, medication, referrals, follow-up, care tasks, chronic care, maternity, pediatrics, telemedicine, remote monitoring, admissions and alerts.
- Deterministic review signals for order/result gaps, appointment/encounter gaps, overdue follow-up, delayed referrals, priority tasks, medication/allergy name overlap and duplicate medication review.
- Patient change detection from longitudinal observations.
- Evidence index linking AI context back to source module/record IDs.
- Patient cross-check endpoint for whole-record review.
- Facility intelligence signals for queue pressure, critical results, urgent tasks, delayed referrals and operational incidents.

## Python intelligence engine

Adds deterministic operations for delta, rolling mean, EWMA, reference-range flags, fluid balance, urine-output rate, time-to-event, coefficient of variation, correlation and batch calculations, plus a screening endpoint. These are calculations/review signals only and do not autonomously diagnose or prescribe.

## Feedback and public interaction

- Authenticated clinician AI feedback: helpful/needs correction, structured reason and optional correction/comment.
- Public anonymous site feedback.
- Public health-information assistant that never receives patient/facility records.

## Safety / governance

The design remains human-reviewed. It does not autonomously prescribe, diagnose, discharge, change medication, authorize payment or make irreversible clinical decisions. Public interactions are separated from patient data. Guidance should be localized and approved before being used as clinical decision support.

The implementation is intended to remain consistent with WHO digital-health classification/SMART-guideline principles and Uganda Ministry of Health privacy, confidentiality, access, sharing and interoperability guidance.
