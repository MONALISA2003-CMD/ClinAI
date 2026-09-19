import fs from 'node:fs';

const main = fs.readFileSync('services/api/src/main.ts', 'utf8');
const events = fs.readFileSync('services/api/src/events/clinicalEvents.ts', 'utf8');
const evaluator = fs.readFileSync('services/api/src/events/cdssEvaluator.ts', 'utf8');
const phase3 = fs.readFileSync('services/api/src/routes/diagnosticsMedicationRoutes.ts', 'utf8');

const required = [
  ['transactional publisher is reused', 'await enqueueClinicalEvent(client,{organizationId:dbOrganizationId(req)'],
  ['stable event key hashing', "createHash('sha256').update(JSON.stringify({type,aggregateId,payload:body}))"],
  ['patient registration event', 'CLINICAL_EVENT_TYPES.PATIENT_REGISTERED'],
  ['allergy event', 'CLINICAL_EVENT_TYPES.ALLERGY_RECORDED'],
  ['appointment creation event', 'CLINICAL_EVENT_TYPES.APPOINTMENT_CREATED'],
  ['queue entry event', 'CLINICAL_EVENT_TYPES.QUEUE_ENTERED'],
  ['clinical order event', 'CLINICAL_EVENT_TYPES.ORDER_CREATED'],
  ['medication order event', ['CLINICAL_EVENT_TYPES.MEDICATION_ORDERED','ctx.clinicalEventTypes.MEDICATION_ORDERED']],
  ['laboratory result event', 'CLINICAL_EVENT_TYPES.LAB_RESULT_CREATED'],
  ['specimen collected event', 'CLINICAL_EVENT_TYPES.SPECIMEN_COLLECTED'],
  ['result verified event', 'CLINICAL_EVENT_TYPES.RESULT_VERIFIED'],
  ['imaging study event', "'imaging.study.created'"],
  ['admission event', 'CLINICAL_EVENT_TYPES.ADMISSION_STARTED'],
  ['discharge event', 'CLINICAL_EVENT_TYPES.DISCHARGE_STARTED'],
  ['care task creation event', 'CLINICAL_EVENT_TYPES.TASK_CREATED'],
  ['medication administration event', 'CLINICAL_EVENT_TYPES.MEDICATION_ADMINISTERED'],
  ['referral completion event', 'CLINICAL_EVENT_TYPES.REFERRAL_COMPLETED'],
];
for (const [name, tokenOrTokens] of required) {
  const tokens = Array.isArray(tokenOrTokens) ? tokenOrTokens : [tokenOrTokens];
  if (!tokens.some(token => main.includes(token) || events.includes(token) || phase3.includes(token))) throw new Error(`Missing Gate 1 contract: ${name}`);
}

if (!events.includes('eventKey?: string')) throw new Error('EventInput must support an explicit stable event key');
if (main.includes('INSERT INTO outbox_events')) throw new Error('Unexpected raw outbox write in main.ts');
if (!evaluator.includes("'allergy.recorded'")) throw new Error('Allergy event must enter the deterministic CDSS event boundary');

const ai = fs.readFileSync('services/api/src/ai/ai-orchestrator.ts', 'utf8');
const providers = fs.readFileSync('services/api/src/ai/ai-providers.ts', 'utf8');
for (const [name, token] of [
  ['AI model selection remains present', 'selectModel'],
  ['AI orchestrator remains present', 'runAgent'],
]) {
  if (!(ai.includes(token) || providers.includes(token))) throw new Error(`AI regression: ${name}`);
}

console.log('ClinAI V25 Gate 1 event coverage audit passed');
