import fs from 'node:fs';
import assert from 'node:assert/strict';
const api=fs.readFileSync(new URL('../services/api/src/main.ts',import.meta.url),'utf8');
const web=fs.readFileSync(new URL('../apps/web/app/page.tsx',import.meta.url),'utf8');
const requiredRoutes=[
'/api/patients/:id/timeline','/api/patients/:id/flow','/api/patients/duplicate-check','/api/patients/:id/merge','/api/check-in/walk-in','/api/triage/:id/route',
'/api/laboratory/specimens/:id/status','/api/imaging/studies','/api/imaging/studies/:id/status','/api/beds/:id/assign','/api/beds/:id/release',
'/api/referral-transfers/:id/status','/api/referrals/:id/network','/api/portal/messages','/api/consents','/api/tasks/care','/api/operations/summary',
'/api/medication-reconciliation','/api/medication-reconciliation/:id/resolve','/api/medication-reconciliation/:patientId'
];
for(const r of requiredRoutes) assert(api.includes(r),`missing ${r}`);
for(const t of ['clinical_workflow_events','patient_consents','security_events','ai_evaluations','offline_devices','referral_network_matches','portal_messages','care_tasks']) assert(api.includes(`CREATE TABLE IF NOT EXISTS ${t}`),`missing schema ${t}`);
assert(!/app\.get\(['"]\/api\/patients\/\:id\/360['"]/.test(api) || (api.match(/app\.get\(['"]\/api\/patients\/\:id\/360['"]/g)||[]).length===1);
const moduleNames=[...web.matchAll(/\[['"]([^'\"]+)['"](?:,\s*\[['"]|,\s*['"])/g)].map(m=>m[1]);
assert(web.includes("PUBLIC HEALTH")&&web.includes("TRUST & CONNECTIONS"),'frontend groups missing');
assert(web.includes('/api/patients/${p.id}/flow')&&web.includes('/api/patients/${p.id}/timeline'),'patient journey not surfaced');
assert(web.includes('patient-stage-grid'),'responsive journey view missing');
console.log('ClinAI V14 integration audit passed');
console.log(`API routes checked: ${requiredRoutes.length}`);
console.log(`Frontend size: ${web.length} bytes`);
