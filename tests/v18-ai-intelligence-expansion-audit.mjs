import fs from 'node:fs';
import assert from 'node:assert/strict';

const ai = fs.readFileSync('services/api/src/ai/ai-orchestrator.ts','utf8');
const clinical = fs.readFileSync('services/api/src/ai/clinical-intelligence.ts','utf8');
const py = fs.readFileSync('services/intelligence/main.py','utf8');
const web = fs.readFileSync('apps/web/app/page.tsx','utf8');
const main = fs.readFileSync('services/api/src/main.ts','utf8');

for (const needle of [
  'buildPatientIntelligence', 'buildEvidenceIndex', 'patient-intelligence/:patientId',
  '/api/ai/feedback', 'publicMode', 'Question intent', 'Cross-module evidence index'
]) assert.ok(ai.includes(needle), `AI layer missing ${needle}`);
for (const needle of [
  'labGaps', 'imagingGaps', 'appointmentEncounterGaps', 'referralGaps',
  'followupGaps', 'medicationAllergyConflicts', 'duplicateMedications', 'observationTrends'
]) assert.ok(clinical.includes(needle), `clinical intelligence missing ${needle}`);
for (const needle of [
  'rolling_mean', 'ewma', 'reference_range_flags', 'fluid_balance',
  'urine_output_rate', 'time_to_event_minutes', 'coefficient_of_variation',
  'correlation', 'batch', '/v1/screen'
]) assert.ok(py.includes(needle), `Python engine missing ${needle}`);
for (const needle of ['PublicFeedbackButton','PublicHealthButton','AIFeedback','Cross-check all modules']) assert.ok(web.includes(needle), `UI missing ${needle}`);
assert.ok(main.includes("startsWith('/api/public/')"), 'public interaction routes are not explicitly unauthenticated');
assert.ok(main.includes('ensureAIInteractionSchema'), 'AI interaction schema bootstrap missing');
console.log('V18 AI intelligence expansion audit: PASS');
