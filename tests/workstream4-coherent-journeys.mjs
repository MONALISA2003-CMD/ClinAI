import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/029-workstream-4-coherent-synthetic-journeys.sql'), 'utf8');
const route = fs.readFileSync(path.join(root, 'services/api/src/routes/workstream4Journeys.ts'), 'utf8');
const main = fs.readFileSync(path.join(root, 'services/api/src/main.ts'), 'utf8');
const doc = fs.readFileSync(path.join(root, 'docs/WORKSTREAM-4-COHERENT-SYNTHETIC-JOURNEYS.md'), 'utf8');

assert.match(migration, /CREATE TABLE IF NOT EXISTS synthetic_journeys/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS synthetic_journey_step_catalog/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS synthetic_journey_templates/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS synthetic_journey_steps/);
assert.match(migration, /syntheticTestData/);
assert.match(migration, /workstream4-synthetic/);
assert.doesNotMatch(migration, /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+(patients|encounters|diagnoses|clinical_orders|invoices|claims)\b/i);
assert.match(migration, /TEST-001/);
assert.match(migration, /TEST-030/);
const profileBlock = migration.match(/profiles\(patient_number,journey_key,title,status,template_key,age_days\) AS \(VALUES[\s\S]*?\) INSERT INTO synthetic_journeys/);
assert.ok(profileBlock, 'profile block missing');
assert.equal((profileBlock[0].match(/'TEST-\d{3}'/g) ?? []).length, 30, 'migration should define exactly 30 TEST patient scenarios');
for (const key of ['emergency','surgery','maternity','medication','pediatric','postnatal','multimorbidity','referral']) assert.match(migration, new RegExp(`'${key}'`));
for (const event of ['emergency.arrived','triage.recorded','procedure.completed','maternity.birth.recorded','maternity.newborn.recorded','maternity.pnc.recorded','medication.dispensed','invoice.created','claim.submitted','reconciliation.completed','followup.due']) assert.match(migration, new RegExp(event.replace('.', '\\.')));
assert.match(migration, /WITH ORDINALITY/);
assert.match(migration, /lag\(s\.outbox_event_id\)/);
assert.match(migration, /correlation_id/);
assert.match(migration, /causation_id/);
assert.match(migration, /WHERE NOT EXISTS\(SELECT 1 FROM clinical_workflow_events/);
assert.match(migration, /jsonb_set\(o\.payload/);

for (const endpoint of [
  '/api/journeys/synthetic',
  '/api/journeys/synthetic/:patientId',
  '/api/journeys/synthetic/by-number/:patientNumber',
  '/api/public/test-patients/:patientNumber/journeys'
]) assert.match(route, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(route, /is_test_data=true/);
assert.match(route, /patientNumber.*TEST-\\d\{3\}/);
assert.match(main, /registerWorkstream4JourneyRoutes/);
assert.match(doc, /30 coherent synthetic patient journeys/i);
assert.match(doc, /354/);
assert.match(doc, /0 journey steps without an authoritative ID/i);

console.log('Workstream 4 coherent synthetic journey static audit passed');
