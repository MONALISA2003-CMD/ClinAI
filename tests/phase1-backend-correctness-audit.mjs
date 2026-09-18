import fs from 'node:fs';
import assert from 'node:assert/strict';

const engine = fs.readFileSync('services/api/src/events/clinicalJourneyEngine.ts','utf8');
const worker = fs.readFileSync('services/api/src/events/clinicalEventWorker.ts','utf8');
const main = fs.readFileSync('services/api/src/main.ts','utf8');
const migration = fs.readFileSync('database/migrations/030-phase1-backend-correctness.sql','utf8');

assert.match(engine, /ON CONFLICT \(source_event_id\) WHERE source_event_id IS NOT NULL DO NOTHING/);
assert.doesNotMatch(engine, /ON CONFLICT \(source_event_id\) DO NOTHING/);
assert.match(worker, /status=CASE WHEN attempts >= max_attempts THEN 'dead_lettered' ELSE 'pending' END/);
assert.match(worker, /dead_lettered_at=CASE WHEN attempts >= max_attempts THEN now\(\) ELSE dead_lettered_at END/);
assert.match(main, /co\.details->>'code' AS code/);
assert.doesNotMatch(main, /co\.patient_id AS "patientId",co\.encounter_id AS "encounterId",co\.code,co\.details->>'description'/);
assert.match(main, /CREATE TABLE IF NOT EXISTS ai_provider_usage/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_provider_usage/);
assert.match(migration, /CREATE OR REPLACE VIEW clinai_workstream5_intelligence_coverage/);
assert.match(migration, /FROM ai_work_runs/);
assert.match(migration, /outbox_events_dead_letter_idx/);

console.log('Phase 1 backend correctness audit passed');
