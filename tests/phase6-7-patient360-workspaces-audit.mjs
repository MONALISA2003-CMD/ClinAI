import fs from 'node:fs';
import assert from 'node:assert/strict';

const api=fs.readFileSync('services/api/src/main.ts','utf8');
const context=fs.readFileSync('services/api/src/intelligence/clinicalContext.ts','utf8');
const intelligence=fs.readFileSync('services/api/src/intelligence/enterpriseIntelligence.ts','utf8');
const orchestrator=fs.readFileSync('services/api/src/ai/ai-orchestrator.ts','utf8');

for (const route of [
  '/api/intelligence/patient-360/:patientId',
  '/api/intelligence/security',
  '/api/intelligence/risk-management',
  '/api/intelligence/clinical-velocity',
  '/api/intelligence/value-based-care'
]) assert(api.includes(route), `Missing Phase 6/7 route: ${route}`);

for (const key of ['finance','claims','payments','supply','availableQuantity','publicHealth','longitudinalEvents','outcomes']) assert((intelligence+orchestrator).includes(key), `Patient 360 synthesis missing: ${key}`);
for (const key of ['medication','finance','surgical','pharmacy','publichealth','followup']) assert(context.includes(key), `Task-specific context missing: ${key}`);
for (const key of ['taskContextApplied','consentScopeApplied']) assert(context.includes(key), `Context policy missing: ${key}`);
for (const key of ['prompt-injection','indirect-injection','data-disclosure','cross-tenant-access','role-spoofing','unauthorized-patient-lookup','tool-misuse','provider-leakage','unsafe-output','abuse-rate-limit']) assert(intelligence.includes(key), `Security control missing: ${key}`);
for (const key of ['risk-classification','evaluation','clinical-validation','approval','monitoring','drift','incident','mitigation','residual-risk','review','retirement']) assert(intelligence.includes(key), `Risk lifecycle missing: ${key}`);
for (const key of ['average_minutes','median_minutes','p90_minutes','unsafeSpeedNeverRewarded','unresolvedSignals']) assert(intelligence.includes(key), `Velocity metric/guard missing: ${key}`);
for (const key of ['hypertension-followup','diabetes-monitoring','immunization','anc-continuity','pnc','chronic-care','critical-result-closure','referral-completion','readmission','appointment-continuity']) assert(intelligence.includes(key), `Value measure missing: ${key}`);
assert(intelligence.includes('minimumNecessary') && orchestrator.includes('finance') && orchestrator.includes('availableQuantity') && orchestrator.includes('publicHealth'), 'AI raw context is not collecting cross-domain Patient 360 data');
assert(orchestrator.includes('queryText:'), 'AI context builder is not receiving the task/question for purpose-specific filtering');
console.log('Phase 6/7 Patient 360 and six intelligence workspace audit passed.');
