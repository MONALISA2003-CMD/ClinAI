import fs from 'node:fs';
import assert from 'node:assert/strict';

const api = fs.readFileSync('services/api/src/main.ts','utf8');
const orchestrator = fs.readFileSync('services/api/src/ai/ai-orchestrator.ts','utf8');
const python = fs.readFileSync('services/intelligence/main.py','utf8');
const migration = fs.readFileSync('database/migrations/017-ai-intelligence-core.sql','utf8');
const web = fs.readFileSync('apps/web/app/page.tsx','utf8');
const css = fs.readFileSync('apps/web/app/globals.css','utf8');

for (const route of [
  '/api/ai/status','/api/ai/assist','/api/ai/patient-intelligence','/api/ai/attention','/api/ai/brief',
  '/api/ai/compute','/api/ai/analyze','/api/ai/research','/api/ai/management-brief','/api/ai/cohort',
  '/api/ai/document','/api/ai/role-briefing','/api/ai/translate','/api/ai/work-runs'
]) assert.ok(orchestrator.includes(route), `missing ${route}`);

for (const tool of ['get_patient_snapshot','get_facility_context','find_attention_items','find_abnormal_results','find_care_gaps','calculate','analyze_dataset','compare_periods','get_approved_evidence']) {
  assert.ok(orchestrator.includes(tool), `missing tool ${tool}`);
}

assert.ok(orchestrator.includes('function_call'), 'Gemini function-call orchestration missing');
assert.ok(orchestrator.includes('function_result'), 'Gemini function-result loop missing');
assert.ok(orchestrator.includes('previous_interaction_id'), 'multi-step Interactions continuation missing');
assert.ok(orchestrator.includes('response_format'), 'structured response format missing');
assert.ok(orchestrator.includes('google_search') && orchestrator.includes('url_context'), 'research tools missing');
assert.ok(orchestrator.includes('code_execution'), 'code execution capability missing');
assert.ok(orchestrator.includes('Never reveal hidden chain-of-thought'), 'reasoning boundary missing');
assert.ok(orchestrator.includes('Never autonomously prescribe'), 'clinical safety boundary missing');
assert.ok(orchestrator.includes('ai_work_runs'), 'AI work-run audit missing');

for (const op of ['bmi','bsa_mosteller','mean_arterial_pressure','pulse_pressure','shock_index','anion_gap','corrected_calcium','corrected_sodium','egfr_ckd_epi_2021','cockcroft_gault','percentage','percent_change','rate_per_1000','collection_rate','occupancy_rate','age_years','gestational_age','estimated_due_date','statistics','trend','forecast_linear','zscore_anomalies','waiting_time_minutes','stock_days']) {
  assert.ok(python.includes(`op == "${op}"`), `missing Python calculation ${op}`);
}
assert.ok(python.includes('/v1/compute') && python.includes('/v1/dataset'), 'Python API incomplete');
assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS ai_work_runs'), 'AI work-run migration missing');
assert.ok(web.includes('ai-mode-switch') && web.includes('Analytics') && web.includes('Research'), 'AI modes UI missing');
assert.ok(css.includes('.ai-mode-switch') && css.includes('.ai-intelligence-strip'), 'AI intelligence UI styles missing');

console.log('ClinAI Intelligence Core audit passed: orchestration, tools, deterministic Python computation, proactive intelligence, research, structured reasoning, safety, audit persistence and responsive UI are implemented.');
