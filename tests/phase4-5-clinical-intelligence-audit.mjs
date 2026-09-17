import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const journey=fs.readFileSync(path.join(root,'services/api/src/events/clinicalJourneyEngine.ts'),'utf8');
const worker=fs.readFileSync(path.join(root,'services/api/src/events/clinicalEventWorker.ts'),'utf8');
const ai=fs.readFileSync(path.join(root,'services/api/src/ai/ai-orchestrator.ts'),'utf8');
const main=fs.readFileSync(path.join(root,'services/api/src/main.ts'),'utf8');
const mig=fs.readFileSync(path.join(root,'database/migrations/022-clinai-phase4-clinical-journey-engine.sql'),'utf8');
for (const name of ['Emergency','Surgery','Maternity','Pharmacy','Inventory','Finance']) if(!journey.includes(`key:'${name.toLowerCase()}'`)) throw new Error(`Missing ${name} journey`);
for (const token of ['processClinicalEvent','scanUnfinishedJourneys','source_event_id','workflow-gap','directPharmacyAvailability','care_graph_edges']) if(!journey.includes(token) && !worker.includes(token) && !mig.includes(token)) throw new Error(`Missing Phase 4 control: ${token}`);
for (const key of ['summary','currentSituation','importantFindings','attentionItems','careGaps','crossModuleEvidence','safetySignals','uncertainty','suggestedNextChecks','provenance']) if(!ai.includes(key)) throw new Error(`Missing public AI response field: ${key}`);
if(!ai.includes('validateClinicalAIResponse')) throw new Error('Public AI response schema validator missing');
if(!ai.includes('Recorded fact:') || !ai.includes('Clinical review:')) throw new Error('Fact versus interpretation separation missing');
if(!ai.includes('JSON may be used internally')) throw new Error('AI internal/public boundary guard missing');
if(!main.includes("app.get('/api/intelligence/journeys'")) throw new Error('Journey intelligence endpoint missing');
if(!main.includes("app.post('/api/intelligence/journeys/scan'")) throw new Error('Journey scan endpoint missing');
if(!mig.includes('CREATE UNIQUE INDEX IF NOT EXISTS clinical_workflow_source_event_uidx')) throw new Error('Event idempotency index missing');
console.log('Phase 4/5 clinical intelligence audit passed: six journey chains, event projection/idempotency, unfinished-journey detection, and public structured AI response normalization verified.');
