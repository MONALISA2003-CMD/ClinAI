import fs from 'node:fs';

const api = fs.readFileSync('services/api/src/main.ts', 'utf8');
const cdss = fs.readFileSync('services/api/src/events/cdssEvaluator.ts', 'utf8');

const forbidden = [
  ['Fastify v4 redirect signature', 'reply.redirect(307,'],
  ['queues.created_at lookup', 'FROM queues WHERE organization_id=$1 ORDER BY created_at'],
  ['queue facility created_at lookup', 'FROM queues WHERE organization_id=$1 AND facility_id IS NOT DISTINCT FROM $2 ORDER BY created_at'],
  ['observations.organization_id', 'FROM observations WHERE organization_id='],
  ['diagnoses.organization_id', 'FROM diagnoses d LEFT JOIN encounters e ON e.id=d.encounter_id WHERE d.organization_id='],
  ['diagnoses.created_at', 'd.created_at'],
  ['clinical_orders.organization_id', 'FROM clinical_orders WHERE organization_id='],
  ['referrals.organization_id', 'FROM referrals r WHERE r.organization_id='],
  ['medication_orders.organization_id in CDSS', 'mo.organization_id'],
  ['allergies.organization_id in CDSS', 'FROM allergies WHERE organization_id='],
];

for (const [name, token] of forbidden) {
  const source = name.includes('CDSS') || name.includes('medication_orders') || name.includes('allergies') ? cdss : api;
  if (source.includes(token)) throw new Error(`Schema contract regression: ${name}`);
}

const required = [
  ['FHIR redirect uses Fastify v5 signature', 'reply.redirect(target,307)'],
  ['queue selection uses stable GENERAL code', "code='GENERAL' LIMIT 1"],
  ['timeline observations scope through patient', 'JOIN patients op ON op.id=o.patient_id'],
  ['timeline diagnoses scope through patient', 'JOIN patients dp ON dp.id=d.patient_id'],
  ['timeline medication time comes from encounter', 'LEFT JOIN encounters e ON e.id=mo.encounter_id'],
  ['CDSS observations scope through patient', 'JOIN patients p ON p.id=o.patient_id'],
  ['CDSS allergies use actual substance column', 'a.substance AS allergen'],
  ['CDSS medication orders scope through patient', 'JOIN patients p ON p.id=mo.patient_id'],
  ['CDSS orders scope through patient', 'JOIN patients p ON p.id=co.patient_id'],
];

for (const [name, token] of required) {
  const source = name.startsWith('CDSS') ? cdss : api;
  if (!source.includes(token)) throw new Error(`Missing schema contract fix: ${name}`);
}

console.log('ClinAI schema contract audit passed');
