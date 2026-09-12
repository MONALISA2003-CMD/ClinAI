# ClinAI Advanced Clinical Layer Research Brief

Research basis for Emergency, Inpatient, Nursing, Surgery, Maternity, Pediatrics, Immunization, Chronic Care, Telemedicine and Remote Monitoring.

## Emergency
WHO Emergency Care Toolkit emphasizes systematic care of acutely ill and injured patients, objective triage, resuscitation-area designation, emergency checklists, acute referral and counter-referral. ClinAI therefore models emergency arrival, acuity, triage level, resuscitation/clinical status, disposition and referral-ready documentation.

## Inpatient
The implementation is organized around admission, ward/bed assignment, active admission status, discharge, discharge summary and follow-up. The system deliberately does not hard-code clinical treatment protocols; those belong in governed local protocols/order sets.

## Nursing
Nursing is treated as a continuous clinical workflow rather than a generic note. Assessments can capture findings, pain, risk flags and the nurse responsible, and medication administration remains linked to medication orders.

## Surgery
WHO Safe Surgery guidance emphasizes multidisciplinary safety checks at key perioperative phases. ClinAI therefore provides a surgery case, consent state, anaesthesia plan and a structured checklist that can be adapted by authorized facility governance.

## Maternity
WHO antenatal and pregnancy/childbirth guidance emphasizes person-centred care, maternal and fetal assessment, prevention, early recognition of complications and timely referral. ClinAI models pregnancy-related events, gestational age, gravida/para, maternal observations, fetal observations, status and notes.

## Pediatrics
WHO IMCI integrates assessment, classification, treatment, prevention, caregiver counselling and referral. ClinAI models pediatric measurements, assessment, IMCI classification, nutrition status and referral requirement rather than embedding a single-country clinical algorithm into the UI.

## Immunization
WHO's 2025 Immunization Digital Adaptation Kit describes software-neutral requirements including workflows, core data elements, decision-support logic, indicators and functional/non-functional requirements. ClinAI therefore stores vaccine identity, dose, administration time, lot/expiry, route/site, vaccinator and next-due information.

## Chronic Care
WHO digital NCD work supports use of digital interventions such as telemedicine and mobile health as components of broader chronic-disease strategies. ClinAI models longitudinal conditions, goals, measures, medications, risk level and next review instead of treating chronic care as one encounter.

## Telemedicine
WHO recommends telemedicine as a complement to health services where patient safety, privacy, traceability, accountability and security can be monitored. ClinAI therefore requires consent, supports identity verification at session start, links sessions to appointments/encounters and records start/end lifecycle states.

## Remote Monitoring
Remote measurements are stored with source, timestamp and validation status. Device readings are explicitly marked unvalidated until clinically reviewed. Threshold alerts create reviewable clinical alerts rather than autonomous treatment decisions.

## Cross-cutting design
WHO SMART Guidelines and Digital Adaptation Kits emphasize standards-based, machine-readable, adaptive, requirements-based and testable digital health content. ClinAI keeps clinical protocols configurable and versioned through its governance layer. AI remains assistive and does not directly issue clinical actions.

## Sources
- WHO Emergency Care Toolkit
- WHO Surgical Safety Checklist / Safe Surgery resources
- WHO recommendations on antenatal care for a positive pregnancy experience
- WHO Pregnancy, Childbirth, Postpartum and Newborn Care
- WHO Managing Childhood Illness / IMCI
- WHO Digital adaptation kit for immunizations (2025)
- WHO Going digital for noncommunicable diseases (2024)
- WHO Consolidated telemedicine implementation guide (2022)
- WHO Recommendations on digital interventions for health system strengthening
- WHO SMART Guidelines
