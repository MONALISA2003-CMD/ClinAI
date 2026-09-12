import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const api=fs.readFileSync(root+'services/api/src/main.ts','utf8');
const migration=fs.readFileSync(root+'database/migrations-011-population-surveillance-intelligence.sql','utf8');
for (const x of ['surveillance_events','surveillance_cases','population_cohorts','population_cohort_members','population_indicators']) if(!migration.includes(x)) throw new Error('Missing '+x);
for (const x of ['/api/surveillance/events','/api/surveillance/cases','/api/surveillance/summary','/api/population/cohorts','/api/population/dashboard']) if(!api.includes(x)) throw new Error('Missing route '+x);
if(!api.includes('requiresClinicianReview') && !api.includes('clinician')) throw new Error('Governance marker missing');
console.log('ClinAI V11 structural check passed');
