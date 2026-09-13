import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url).pathname;
const api = fs.readFileSync(root+'services/api/src/main.ts','utf8');
const migration = fs.readFileSync(root+'database/migrations-009-uganda-child-health-immunization.sql','utf8');
for (const route of [
  '/api/child-health/:patientId','/api/child-health/visits','/api/child-health/growth','/api/child-health/imci','/api/immunization/due/:patientId','/api/immunization/reviews'
]) assert.ok(api.includes(`'${route}'`), `missing ${route}`);
for (const table of ['child_health_visits','child_growth_measurements','child_imci_assessments','immunization_reviews']) assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `missing ${table}`);
for (const source of ['UG-MOH-IMNCI-2020','UG-MOH-IMMUNIZATION-2025','WHO-SMART-DAK-IMMZ-1.1.0']) assert.ok(api.includes(source), `missing source ${source}`);
console.log('ClinAI V9 structural check passed');
