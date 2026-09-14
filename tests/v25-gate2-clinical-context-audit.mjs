import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const context = fs.readFileSync(path.join(root, 'services/api/src/intelligence/clinicalContext.ts'), 'utf8');
const orchestrator = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-orchestrator.ts'), 'utf8');

for (const token of ['buildClinicalContext','purposeFor','allowedModules','patient_consents','ai-consent-withdrawn','consentScopeApplied']) {
  assert(context.includes(token), `Gate 2 context layer missing ${token}`);
}
assert(orchestrator.includes("../intelligence/clinicalContext.js"), 'AI orchestrator is not connected to Clinical Context Layer');
assert(orchestrator.includes("patientContext(deps.pool, organizationId, options.patientId, options.purpose, req)"), 'runAgent does not pass purpose/request into context layer');
assert(orchestrator.includes("patientContext(deps.pool, orgId, String(args.patientId), 'cdss', req)"), 'CDSS tool does not use context policy');

for (const forbidden of ['DROP TABLE','TRUNCATE TABLE','DROP DATABASE','DELETE FROM patients']) {
  assert(!context.toUpperCase().includes(forbidden), `Destructive SQL found in context layer: ${forbidden}`);
}

console.log('ClinAI V25 Gate 2 Clinical Context audit passed');
