import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_MODELS, availableModels, configuredProviders, selectModel, callOpenAICompatible, stableRequestKey } from './ai-providers.js';

type Row = Record<string, any>;
type Deps = {
  app: FastifyInstance;
  pool: Pool | null;
  dbOrganizationId: (req: any) => string | null;
  dbUserId: (req: any) => string | null;
};

const GEMINI_API_KEY = process.env.GEMINI_AUTHORIZATION_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_FAST_MODEL = process.env.GEMINI_FAST_MODEL || GEMINI_MODEL;
const GEMINI_REASONING_MODEL = process.env.GEMINI_REASONING_MODEL || GEMINI_MODEL;
const GEMINI_API_VERSION = 'v1';
const AI_PROMPT_VERSION = 'clinai-intelligence-core-1';
const INTELLIGENCE_SERVICE_URL = (process.env.INTELLIGENCE_SERVICE_URL || '').replace(/\/$/, '');
const ENABLE_GEMINI_CODE_EXECUTION = process.env.GEMINI_ENABLE_CODE_EXECUTION === 'true';
const FREE_TIER_MODE = process.env.GEMINI_FREE_TIER_MODE !== 'false';
const GEMINI_MAX_TOOL_ROUNDS = FREE_TIER_MODE ? 0 : Math.min(4, Math.max(0, Number(process.env.GEMINI_MAX_TOOL_ROUNDS || 2)));
const GEMINI_FREE_DAILY_LIMIT = Math.max(1, Number(process.env.GEMINI_FREE_DAILY_LIMIT || 4));
const GEMINI_FREE_MIN_INTERVAL_MS = Math.max(0, Number(process.env.GEMINI_FREE_MIN_INTERVAL_MS || 15000));
const GEMINI_FREE_MAX_INPUT_CHARS = Math.max(4000, Number(process.env.GEMINI_FREE_MAX_INPUT_CHARS || 18000));
let freeTierLastRequestAt = 0;
let freeTierRequestsToday = 0;
let freeTierDay = new Date().toISOString().slice(0, 10);
let freeTierLock: Promise<void> = Promise.resolve();
const freeTierCache = new Map<string, { expiresAt: number; result: any }>();
const GEMINI_FREE_CACHE_MS = Math.max(30000, Number(process.env.GEMINI_FREE_CACHE_MS || 300000));
const ALLOW_PUBLIC_AI_WITH_PATIENT_DATA = process.env.CLINAI_ALLOW_PUBLIC_AI_WITH_PATIENT_DATA === 'true';
const MULTI_MODEL_MODE = process.env.CLINAI_MULTI_MODEL_MODE !== 'false';
const AI_FALLBACK_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.CLINAI_AI_FALLBACK_ATTEMPTS || 3)));
const multiModelCache = new Map<string, { expiresAt: number; result: any }>();
const MULTI_MODEL_CACHE_MS = Math.max(30000, Number(process.env.CLINAI_MULTI_MODEL_CACHE_MS || 300000));
const AI_PROVIDER_TIMEOUT_MS = Math.max(3000, Number(process.env.CLINAI_PROVIDER_TIMEOUT_MS || 9000));
const AI_QUICK_MAX_TOKENS = Math.max(300, Number(process.env.CLINAI_QUICK_MAX_TOKENS || 700));
const AI_STANDARD_MAX_TOKENS = Math.max(500, Number(process.env.CLINAI_STANDARD_MAX_TOKENS || 1800));
const AI_CONTEXT_CACHE_MS = Math.max(5000, Number(process.env.CLINAI_CONTEXT_CACHE_MS || 30000));
const AI_FREE_TOOL_ROUNDS = Math.max(0, Math.min(1, Number(process.env.CLINAI_FREE_TOOL_ROUNDS || 1)));
const contextCache = new Map<string, { expiresAt: number; value: any }>();

async function acquireFreeTierSlot() {
  if (!FREE_TIER_MODE) return;
  const current = freeTierLock.then(async () => {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== freeTierDay) { freeTierDay = day; freeTierRequestsToday = 0; }
    if (freeTierRequestsToday >= GEMINI_FREE_DAILY_LIMIT) {
      throw Object.assign(new Error('ClinAI free AI usage limit has been reached for today. Please try again after the daily quota resets.'), { statusCode: 429, code: 'LOCAL_FREE_TIER_LIMIT' });
    }
    const wait = Math.max(0, GEMINI_FREE_MIN_INTERVAL_MS - (Date.now() - freeTierLastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    freeTierLastRequestAt = Date.now();
    freeTierRequestsToday += 1;
  });
  freeTierLock = current.catch(() => undefined);
  return current;
}

const aiSafety = [
  'Clinical decision support only. A qualified healthcare professional remains responsible for diagnosis and treatment.',
  'Never invent patient facts, results, diagnoses, medications, measurements, or guideline requirements.',
  'Distinguish recorded facts, deterministic calculations, interpretation, uncertainty, and suggested review.',
  'Never autonomously prescribe, diagnose, discharge, alter medication, silently modify records, authorize payment, or make irreversible clinical decisions.',
  'Use deterministic tools for calculations whenever available instead of estimating arithmetic in prose.',
  'When evidence conflicts or is incomplete, state the conflict and request human review.',
  'Never reveal hidden chain-of-thought. Provide only a concise reasoning summary describing evidence and method.',
];

const responseSchema = {
  type: 'object',
  properties: {
    directAnswer: { type: 'string' },
    recordedFacts: { type: 'array', items: { type: 'string' } },
    calculations: { type: 'array', items: { type: 'string' } },
    reasoningSummary: { type: 'string' },
    suggestedReview: { type: 'array', items: { type: 'string' } },
    uncertainty: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'moderate', 'low', 'insufficient'] },
  },
  required: ['directAnswer', 'recordedFacts', 'calculations', 'reasoningSummary', 'suggestedReview', 'uncertainty', 'evidence', 'confidence'],
};

const baseSystem = `You are ClinAI Intelligence, the reasoning layer of a healthcare information system.
Your job is to understand the user's request, decide what evidence is needed, use the available ClinAI tools, perform or delegate deterministic calculations, reconcile conflicting information, and then communicate a useful result.

Do not behave like a generic chatbot. Treat the connected healthcare record as the source of truth for patient and facility facts. If the request needs data that is not available, say so.

Reasoning policy:
1. First identify the task type: lookup, clinical context review, calculation, comparison, trend, forecasting, operational analysis, documentation, research, or action drafting.
2. Use the smallest sufficient set of tools, but do not answer from assumptions when a tool can retrieve the required evidence.
3. For arithmetic, statistics, dates, rates, percentages, trend calculations and other numerical work, call the deterministic compute tool.
4. For multi-step or dataset analysis, use the Python intelligence tool when appropriate.
5. Cross-check important findings against more than one relevant source when the question spans modules.
6. Never turn an inference into a recorded fact.
7. For clinical questions, explain what was found and why it may deserve professional review, without autonomous diagnosis or treatment.
8. For operational questions, quantify the finding whenever the data permits it.
9. For research questions, distinguish external evidence from the patient's/facility's own records.
10. Give a concise reasoning summary, not private chain-of-thought.
11. If asked to perform an action, prepare or propose the action unless the action is explicitly approved and the endpoint is designed for human confirmation.

Formatting policy:
Return structured JSON matching the response schema. The application will render it for people. Do not use Markdown stars, hashes, tables, code fences, or decorative symbols.

Safety rules:
${aiSafety.join('\n')}`;

function aiText(value: any, max = 14000) {
  try {
    const x = typeof value === 'string' ? value : JSON.stringify(value);
    return x.length > max ? `${x.slice(0, max)}…` : x;
  } catch {
    return String(value);
  }
}

async function query(pool: Pool | null, sql: string, params: any[] = []) {
  if (!pool) return [] as Row[];
  try { return (await pool.query(sql, params)).rows; } catch { return [] as Row[]; }
}

async function patientContext(pool: Pool | null, organizationId: string | null, patientId: string) {
  if (!organizationId) return { patient: null };
  const [patient, allergies, encounters, observations, diagnoses, orders, medications, referrals, followups, immunizations, maternal, pediatrics, growth, carePlans, tasks, notes, reconciliation, events] = await Promise.all([
    query(pool, `SELECT id,patient_number AS "patientNumber",first_name AS "firstName",middle_name AS "middleName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,phone,address,status,preferred_language AS "preferredLanguage" FROM patients WHERE id=$1 AND organization_id=$2`, [patientId, organizationId]),
    query(pool, `SELECT substance,reaction,severity,status FROM allergies a JOIN patients p ON p.id=a.patient_id WHERE a.patient_id=$1 AND p.organization_id=$2 ORDER BY a.id DESC LIMIT 30`, [patientId, organizationId]),
    query(pool, `SELECT id,type,status,started_at AS "startedAt",ended_at AS "endedAt",reason FROM encounters WHERE patient_id=$1 AND organization_id=$2 ORDER BY started_at DESC LIMIT 40`, [patientId, organizationId]),
    query(pool, `SELECT id,code,display,value_numeric AS "valueNumeric",value_text AS "valueText",unit,observed_at AS "observedAt" FROM observations o JOIN patients p ON p.id=o.patient_id WHERE o.patient_id=$1 AND p.organization_id=$2 ORDER BY observed_at DESC LIMIT 60`, [patientId, organizationId]),
    query(pool, `SELECT id,code,display,status,diagnosis_type AS "diagnosisType" FROM diagnoses d JOIN patients p ON p.id=d.patient_id WHERE d.patient_id=$1 AND p.organization_id=$2 ORDER BY id DESC LIMIT 40`, [patientId, organizationId]),
    query(pool, `SELECT id,order_type AS "orderType",status,priority,details,created_at AS "createdAt" FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE co.patient_id=$1 AND p.organization_id=$2 ORDER BY created_at DESC LIMIT 50`, [patientId, organizationId]),
    query(pool, `SELECT mo.id,mo.dose,mo.frequency,mo.route,mo.duration,mo.quantity,mo.status,m.code,m.name,m.strength,m.form FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id JOIN patients p ON p.id=mo.patient_id WHERE mo.patient_id=$1 AND p.organization_id=$2 ORDER BY mo.id DESC LIMIT 40`, [patientId, organizationId]),
    query(pool, `SELECT r.id,r.status,r.reason,r.destination,r.created_at AS "createdAt" FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE r.patient_id=$1 AND p.organization_id=$2 ORDER BY r.created_at DESC LIMIT 40`, [patientId, organizationId]),
    query(pool, `SELECT id,module,status,payload,created_at AS "createdAt" FROM module_records WHERE organization_id=$2 AND payload->>'patientId'=$1 AND module IN ('follow-up','tasks') ORDER BY created_at DESC LIMIT 50`, [patientId, organizationId]),
    query(pool, `SELECT vaccine_code AS "vaccineCode",vaccine_name AS "vaccineName",dose_number AS "doseNumber",administered_at AS "administeredAt",next_due_at AS "nextDueAt",status FROM immunizations WHERE patient_id=$1 AND organization_id=$2 ORDER BY administered_at DESC LIMIT 50`, [patientId, organizationId]),
    query(pool, `SELECT event_type AS "eventType",gestational_age_weeks AS "gestationalAgeWeeks",gravida,para,status,event_at AS "eventAt",notes FROM maternity_records WHERE patient_id=$1 AND organization_id=$2 ORDER BY event_at DESC LIMIT 40`, [patientId, organizationId]),
    query(pool, `SELECT age_months AS "ageMonths",weight_kg AS "weightKg",height_cm AS "heightCm",muac_mm AS "muacMm",temperature,respiratory_rate AS "respiratoryRate",spo2,assessment,imci_classification AS "imciClassification",nutrition_status AS "nutritionStatus",referral_required AS "referralRequired",created_at AS "createdAt" FROM pediatric_assessments WHERE patient_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 40`, [patientId, organizationId]),
    query(pool, `SELECT measured_at AS "measuredAt",age_days AS "ageDays",weight_kg AS "weightKg",length_height_cm AS "heightCm",head_circumference_cm AS "headCircumferenceCm",muac_mm AS "muacMm",z_scores AS "zScores",growth_interpretation AS "growthInterpretation",source_standard AS "sourceStandard" FROM child_growth_measurements WHERE patient_id=$1 AND organization_id=$2 ORDER BY measured_at DESC LIMIT 40`, [patientId, organizationId]),
    query(pool, `SELECT id,title,status,goals FROM care_plans cp JOIN patients p ON p.id=cp.patient_id WHERE cp.patient_id=$1 AND p.organization_id=$2 ORDER BY id DESC LIMIT 30`, [patientId, organizationId]),
    query(pool, `SELECT id,task_type AS "taskType",title,priority,status,due_at AS "dueAt",payload,created_at AS "createdAt" FROM care_tasks WHERE patient_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 40`, [patientId, organizationId]),
    query(pool, `SELECT cn.id,cn.note_type AS "noteType",cn.subjective,cn.objective,cn.assessment,cn.plan,cn.signed_at AS "signedAt",e.started_at AS "encounterAt" FROM clinical_notes cn JOIN encounters e ON e.id=cn.encounter_id JOIN patients p ON p.id=e.patient_id WHERE e.patient_id=$1 AND p.organization_id=$2 ORDER BY e.started_at DESC LIMIT 30`, [patientId, organizationId]),
    query(pool, `SELECT id,status,medication_name AS "medicationName",discrepancies,created_at AS "createdAt" FROM medication_reconciliation WHERE patient_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 30`, [patientId, organizationId]),
    query(pool, `SELECT event_type AS kind,from_state AS "fromState",to_state AS "toState",payload,created_at AS at FROM clinical_workflow_events WHERE patient_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 60`, [patientId, organizationId]),
  ]);
  return { patient: patient[0] || null, allergies, encounters, observations, diagnoses, orders, medications, referrals, followups, immunizations, maternal, pediatrics, growth, carePlans, tasks, notes, reconciliation, events };
}

async function orgContext(pool: Pool | null, organizationId: string | null) {
  if (!organizationId) return {};
  const [summary, queue, labs, tasks, referrals, appointments, encounters, billing, facilities, inventory, incidents] = await Promise.all([
    query(pool, `SELECT (SELECT count(*) FROM patients WHERE organization_id=$1)::int AS patients,(SELECT count(*) FROM appointments WHERE organization_id=$1 AND start_at::date=current_date)::int AS appointmentsToday,(SELECT count(*) FROM encounters WHERE organization_id=$1 AND status IN ('active','in-progress'))::int AS activeEncounters`, [organizationId]),
    query(pool, `SELECT qe.status,qe.priority,count(*)::int AS count,round(extract(epoch from (now()-min(qe.joined_at)))/60)::int AS oldestWaitMinutes FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.status NOT IN ('completed','cancelled','no-show') GROUP BY qe.status,qe.priority`, [organizationId]),
    query(pool, `SELECT count(*) FILTER (WHERE lr.critical=true AND lr.status<>'released')::int AS criticalUnreleased,count(*) FILTER (WHERE lr.status='preliminary')::int AS pendingVerification,count(*)::int AS totalResults FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE co.organization_id=$1`, [organizationId]),
    query(pool, `SELECT count(*) FILTER (WHERE status='open')::int AS openTasks,count(*) FILTER (WHERE priority IN ('critical','urgent') AND status='open')::int AS urgentTasks FROM care_tasks WHERE organization_id=$1`, [organizationId]),
    query(pool, `SELECT count(*) FILTER (WHERE status NOT IN ('completed','closed'))::int AS openReferrals,count(*) FILTER (WHERE status NOT IN ('completed','closed') AND created_at<now()-interval '7 days')::int AS delayedReferrals FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1`, [organizationId]),
    query(pool, `SELECT status,count(*)::int AS count FROM appointments WHERE organization_id=$1 AND start_at::date=current_date GROUP BY status`, [organizationId]),
    query(pool, `SELECT status,count(*)::int AS count FROM encounters WHERE organization_id=$1 AND started_at::date=current_date GROUP BY status`, [organizationId]),
    query(pool, `SELECT count(*)::int AS invoices,coalesce(sum(total),0)::numeric AS billed,coalesce((SELECT sum(amount) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.organization_id=$1 AND p.status='paid'),0)::numeric AS paid FROM invoices WHERE organization_id=$1`, [organizationId]),
    query(pool, `SELECT f.id,f.name,f.type,coalesce((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='occupied'),0)::int occupied,coalesce((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='available'),0)::int available FROM facilities f WHERE f.organization_id=$1 ORDER BY f.name`, [organizationId]),
    query(pool, `SELECT ii.id,ii.name,ii.unit,ii.reorder_level AS "reorderLevel",coalesce(sum(ib.quantity),0)::numeric AS quantity FROM inventory_items ii LEFT JOIN inventory_batches ib ON ib.item_id=ii.id WHERE ii.organization_id=$1 GROUP BY ii.id,ii.name,ii.unit,ii.reorder_level HAVING coalesce(sum(ib.quantity),0)<=ii.reorder_level ORDER BY quantity`, [organizationId]),
    query(pool, `SELECT severity,title,status,started_at AS "startedAt",resolved_at AS "resolvedAt" FROM facility_operational_incidents WHERE organization_id=$1 AND status NOT IN ('resolved','closed') ORDER BY started_at DESC LIMIT 30`, [organizationId]),
  ]);
  return { summary: summary[0] || {}, queue, labs: labs[0] || {}, tasks: tasks[0] || {}, referrals: referrals[0] || {}, appointments, encounters, billing: billing[0] || {}, facilities, inventoryAlerts: inventory, incidents };
}

async function approvedKnowledge(pool: Pool | null, organizationId: string | null) {
  return query(pool, `SELECT id,title,jurisdiction,specialty,source_url AS "sourceUrl",version,effective_from AS "effectiveFrom",content FROM ai_knowledge_sources WHERE status='approved' AND (organization_id IS NULL OR organization_id=$1) ORDER BY created_at DESC LIMIT 12`, [organizationId]).then(rows => rows.map(x => ({ ...x, content: aiText(x.content, 6000) })));
}

async function intelligenceCompute(operation: string, inputs: Row) {
  if (!INTELLIGENCE_SERVICE_URL) return { ok: false, unavailable: true, error: 'INTELLIGENCE_SERVICE_URL is not configured' };
  const response = await fetch(`${INTELLIGENCE_SERVICE_URL}/v1/compute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, inputs }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || 'Computation failed');
  return data.result;
}

async function intelligenceDataset(operation: string, values: number[], options: Row = {}) {
  if (!INTELLIGENCE_SERVICE_URL) return { ok: false, unavailable: true, error: 'INTELLIGENCE_SERVICE_URL is not configured' };
  const response = await fetch(`${INTELLIGENCE_SERVICE_URL}/v1/dataset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, values, ...options }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || 'Dataset analysis failed');
  return data.result;
}

async function proactiveAttention(pool: Pool | null, organizationId: string | null) {
  if (!organizationId) return [];
  const [criticalLabs, overdueFollowups, urgentTasks, delayedReferrals, longWaits, stockAlerts, incidents] = await Promise.all([
    query(pool, `SELECT lr.id,lr.critical,lr.abnormal_flag AS "abnormalFlag",lr.status,lt.name AS "testName",co.patient_id AS "patientId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id JOIN patients p ON p.id=co.patient_id WHERE co.organization_id=$1 AND lr.critical=true AND lr.status<>'released' ORDER BY lr.id DESC LIMIT 20`, [organizationId]),
    query(pool, `SELECT id,payload->>'patientId' AS "patientId",payload->>'reason' AS reason,payload->>'dueAt' AS "dueAt",created_at AS "createdAt" FROM module_records WHERE organization_id=$1 AND module='follow-up' AND status IN ('due','open') AND payload->>'dueAt' IS NOT NULL AND (payload->>'dueAt')::timestamptz < now() ORDER BY (payload->>'dueAt')::timestamptz LIMIT 30`, [organizationId]),
    query(pool, `SELECT id,patient_id AS "patientId",title,priority,due_at AS "dueAt" FROM care_tasks WHERE organization_id=$1 AND status='open' AND priority IN ('critical','urgent') ORDER BY CASE priority WHEN 'critical' THEN 0 ELSE 1 END,due_at NULLS LAST LIMIT 30`, [organizationId]),
    query(pool, `SELECT r.id,r.patient_id AS "patientId",r.destination,r.reason,r.created_at AS "createdAt",p.patient_number AS "patientNumber" FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.status NOT IN ('completed','closed') AND r.created_at<now()-interval '7 days' ORDER BY r.created_at LIMIT 30`, [organizationId]),
    query(pool, `SELECT qe.id,qe.patient_id AS "patientId",q.name AS queue,qe.priority,round(extract(epoch from (now()-qe.joined_at))/60)::int AS "waitMinutes" FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.status NOT IN ('completed','cancelled','no-show') AND qe.joined_at<now()-interval '30 minutes' ORDER BY qe.joined_at LIMIT 30`, [organizationId]),
    query(pool, `SELECT ii.id,ii.name,ii.reorder_level AS "reorderLevel",coalesce(sum(ib.quantity),0)::numeric AS quantity FROM inventory_items ii LEFT JOIN inventory_batches ib ON ib.item_id=ii.id WHERE ii.organization_id=$1 GROUP BY ii.id,ii.name,ii.reorder_level HAVING coalesce(sum(ib.quantity),0)<=ii.reorder_level ORDER BY quantity LIMIT 30`, [organizationId]),
    query(pool, `SELECT id,severity,title,description,status,started_at AS "startedAt" FROM facility_operational_incidents WHERE organization_id=$1 AND status NOT IN ('resolved','closed') ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,started_at LIMIT 30`, [organizationId]),
  ]);
  const items: Row[] = [];
  for (const x of criticalLabs) items.push({ severity: 'urgent', type: 'critical-result', title: `Critical laboratory result requires review`, patientId: x.patientId, patientNumber: x.patientNumber, reason: `${x.testName || 'A laboratory result'} is marked critical and has not been released.`, evidence: [x], suggestedReview: 'Review the result and the patient context promptly.' });
  for (const x of overdueFollowups) items.push({ severity: 'attention', type: 'overdue-followup', title: 'Follow-up is overdue', patientId: x.patientId, reason: x.reason || 'A recorded follow-up date has passed.', evidence: [x], suggestedReview: 'Review the follow-up status and contact or schedule as appropriate.' });
  for (const x of urgentTasks) items.push({ severity: x.priority === 'critical' ? 'urgent' : 'attention', type: 'priority-task', title: x.title, patientId: x.patientId, reason: `An open ${x.priority} task remains in the care workflow.`, evidence: [x], suggestedReview: 'Review the task owner and due time.' });
  for (const x of delayedReferrals) items.push({ severity: 'attention', type: 'referral-delay', title: 'Referral may be delayed', patientId: x.patientId, reason: `The referral has remained open for more than 7 days.`, evidence: [x], suggestedReview: 'Review referral status and receiving-facility communication.' });
  for (const x of longWaits) items.push({ severity: x.waitMinutes >= 60 ? 'urgent' : 'attention', type: 'queue-delay', title: 'Patient waiting longer than expected', patientId: x.patientId, reason: `${x.waitMinutes} minutes recorded in the current queue.`, evidence: [x], suggestedReview: 'Review current queue pressure and triage/service status.' });
  for (const x of stockAlerts) items.push({ severity: Number(x.quantity) <= 0 ? 'urgent' : 'attention', type: 'stock-alert', title: `Inventory needs attention: ${x.name}`, reason: `Recorded quantity is ${x.quantity}, at or below the reorder level of ${x.reorderLevel}.`, evidence: [x], suggestedReview: 'Review current stock, open procurement and expected consumption.' });
  for (const x of incidents) items.push({ severity: x.severity === 'critical' ? 'urgent' : 'attention', type: 'facility-incident', title: x.title, reason: x.description || `An active ${x.severity} facility incident is recorded.`, evidence: [x], suggestedReview: 'Review incident ownership and mitigation status.' });
  return items.slice(0, 100);
}

const toolDeclarations = [
  { type: 'function', name: 'get_patient_snapshot', description: 'Retrieve a comprehensive, tenant-scoped patient record for a patient already identified by ID.', parameters: { type: 'object', properties: { patientId: { type: 'string' } }, required: ['patientId'] } },
  { type: 'function', name: 'get_facility_context', description: 'Retrieve current tenant-scoped facility, queue, laboratory, task, referral, appointment, encounter, billing, capacity, inventory and incident information.', parameters: { type: 'object', properties: {} } },
  { type: 'function', name: 'find_attention_items', description: 'Find deterministic proactive attention items across the facility, including critical results, overdue follow-up, urgent tasks, referral delays, long waits, stock alerts and incidents.', parameters: { type: 'object', properties: { patientId: { type: 'string', description: 'Optional patient filter' } } } },
  { type: 'function', name: 'find_abnormal_results', description: 'Find abnormal or critical laboratory results for the current organization, optionally for one patient.', parameters: { type: 'object', properties: { patientId: { type: 'string' }, limit: { type: 'integer' } } } },
  { type: 'function', name: 'find_care_gaps', description: 'Find overdue follow-ups, open care gaps, incomplete referrals and priority care tasks.', parameters: { type: 'object', properties: { patientId: { type: 'string' }, limit: { type: 'integer' } } } },
  { type: 'function', name: 'calculate', description: 'Run a deterministic clinical, operational or mathematical calculation. Use this instead of doing arithmetic in prose.', parameters: { type: 'object', properties: { operation: { type: 'string', description: 'Supported operations include bmi, bsa_mosteller, mean_arterial_pressure, pulse_pressure, shock_index, anion_gap, anion_gap_with_potassium, corrected_calcium, corrected_sodium, egfr_ckd_epi_2021, cockcroft_gault, percentage, percent_change, rate_per_1000, collection_rate, occupancy_rate, age_years, gestational_age, estimated_due_date, statistics, trend, forecast_linear, zscore_anomalies, waiting_time_minutes, stock_days' }, inputs: { type: 'object' } }, required: ['operation','inputs'] } },
  { type: 'function', name: 'analyze_dataset', description: 'Use the deterministic Python intelligence engine for descriptive statistics, trends, forecasts, anomalies or period comparisons.', parameters: { type: 'object', properties: { operation: { type: 'string', enum: ['describe','trend','forecast','anomalies','compare'] }, values: { type: 'array', items: { type: 'number' } }, secondValues: { type: 'array', items: { type: 'number' } }, horizon: { type: 'integer' }, threshold: { type: 'number' } }, required: ['operation','values'] } },
  { type: 'function', name: 'compare_periods', description: 'Compare patient activity, appointments, encounters, billing and queue activity across two time windows.', parameters: { type: 'object', properties: { currentDays: { type: 'integer' }, previousDays: { type: 'integer' } } } },
  { type: 'function', name: 'get_approved_evidence', description: 'Retrieve approved ClinAI knowledge sources and organization-approved guidance metadata.', parameters: { type: 'object', properties: { specialty: { type: 'string' } } } },
];

async function executeTool(name: string, args: Row, deps: Deps, req: any) {
  const organizationId = deps.dbOrganizationId(req);
  if (name === 'get_patient_snapshot') return patientContext(deps.pool, organizationId, String(args.patientId));
  if (name === 'get_facility_context') return orgContext(deps.pool, organizationId);
  if (name === 'find_attention_items') {
    const all = await proactiveAttention(deps.pool, organizationId);
    return args.patientId ? all.filter(x => x.patientId === args.patientId) : all;
  }
  if (name === 'find_abnormal_results') {
    const limit = Math.min(100, Math.max(1, Number(args.limit || 30)));
    return query(deps.pool, `SELECT lr.id,lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status,lt.name AS "testName",co.patient_id AS "patientId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",ls.received_at AS "receivedAt" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id JOIN patients p ON p.id=co.patient_id WHERE co.organization_id=$1 AND (lr.critical=true OR lr.abnormal_flag IS NOT NULL AND lr.abnormal_flag<>'normal') ${args.patientId ? 'AND co.patient_id=$2' : ''} ORDER BY ls.received_at DESC LIMIT ${limit}`, args.patientId ? [organizationId, args.patientId] : [organizationId]);
  }
  if (name === 'find_care_gaps') {
    const all = await proactiveAttention(deps.pool, organizationId);
    return all.filter(x => ['overdue-followup','referral-delay','priority-task'].includes(x.type) && (!args.patientId || x.patientId === args.patientId)).slice(0, Number(args.limit || 50));
  }
  if (name === 'calculate') return intelligenceCompute(String(args.operation), args.inputs || {});
  if (name === 'analyze_dataset') return intelligenceDataset(String(args.operation), (args.values || []).map(Number), { second_values: args.secondValues?.map(Number), horizon: Number(args.horizon || 1), threshold: Number(args.threshold || 2.5) });
  if (name === 'compare_periods') {
    const currentDays = Math.min(365, Math.max(1, Number(args.currentDays || 7)));
    const previousDays = Math.min(365, Math.max(1, Number(args.previousDays || currentDays)));
    const current = await query(deps.pool, `SELECT (SELECT count(*) FROM appointments WHERE organization_id=$1 AND start_at>=now()-make_interval(days => $2))::int AS appointments,(SELECT count(*) FROM encounters WHERE organization_id=$1 AND started_at>=now()-make_interval(days => $2))::int AS encounters,(SELECT coalesce(sum(total),0) FROM invoices WHERE organization_id=$1 AND created_at>=now()-make_interval(days => $2))::numeric AS billed`, [organizationId, currentDays]);
    const previous = await query(deps.pool, `SELECT (SELECT count(*) FROM appointments WHERE organization_id=$1 AND start_at>=now()-make_interval(days => $2+$3) AND start_at<now()-make_interval(days => $2))::int AS appointments,(SELECT count(*) FROM encounters WHERE organization_id=$1 AND started_at>=now()-make_interval(days => $2+$3) AND started_at<now()-make_interval(days => $2))::int AS encounters,(SELECT coalesce(sum(total),0) FROM invoices WHERE organization_id=$1 AND created_at>=now()-make_interval(days => $2+$3) AND created_at<now()-make_interval(days => $2))::numeric AS billed`, [organizationId, currentDays, previousDays]);
    const c = current[0] || {}, p = previous[0] || {};
    const result: Row = { currentWindowDays: currentDays, previousWindowDays: previousDays, current: c, previous: p, changes: {} };
    for (const metric of ['appointments','encounters','billed']) {
      const a = Number(p[metric] || 0), b = Number(c[metric] || 0);
      result.changes[metric] = a === 0 ? { absolute: b - a, percent: null } : { absolute: b - a, percent: ((b - a) / Math.abs(a)) * 100 };
    }
    return result;
  }
  if (name === 'get_approved_evidence') {
    const rows = await approvedKnowledge(deps.pool, organizationId);
    return args.specialty ? rows.filter(x => !x.specialty || String(x.specialty).toLowerCase().includes(String(args.specialty).toLowerCase())) : rows;
  }
  throw new Error(`Tool not allowed: ${name}`);
}

function extractFunctionCalls(data: any) {
  return (data?.steps || []).filter((step: any) => step?.type === 'function_call');
}

function extractText(data: any) {
  if (data?.output_text) return String(data.output_text);
  for (let i = (data?.steps || []).length - 1; i >= 0; i -= 1) {
    for (const block of data.steps[i]?.content || []) if (block?.type === 'text' && block.text) return String(block.text);
  }
  return '';
}

function parseStructured(text: string): Row | null {
  try { const x = JSON.parse(text); return x && typeof x === 'object' ? x : null; } catch { return null; }
}

function responseToPlain(answer: Row | null, fallback: string) {
  if (!answer) return fallback;
  const lines: string[] = [];
  const add = (heading: string, value: any) => {
    const values = Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
    if (!values.length) return;
    lines.push(heading);
    for (const item of values) lines.push(String(item));
  };
  add('Direct answer', answer.directAnswer);
  add('Recorded facts', answer.recordedFacts);
  add('Calculations', answer.calculations);
  add('Reasoning summary', answer.reasoningSummary);
  add('Suggested review', answer.suggestedReview);
  add('Uncertainty', answer.uncertainty);
  add('Evidence from record', answer.evidence);
  add('Confidence', answer.confidence);
  return lines.join('\n');
}

async function recordWork(pool: Pool | null, req: any, organizationId: string | null, patientId: string | null, run: Row) {
  if (!pool || !organizationId) return;
  try {
    await pool.query(`INSERT INTO ai_work_runs(organization_id,user_id,patient_id,run_id,purpose,mode,model,status,question,tools_used,calculations,evidence_count,latency_ms,confidence,safety_flags,result_summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [organizationId, depsUser(req), patientId, run.runId, run.purpose, run.mode, run.model, run.status, run.question, JSON.stringify(run.toolsUsed || []), JSON.stringify(run.calculations || []), Number(run.evidenceCount || 0), Number(run.latencyMs || 0), run.confidence || null, JSON.stringify(run.safetyFlags || []), JSON.stringify(run.resultSummary || {})]);
  } catch {}
}

function depsUser(req: any) { return req.user?.sub && req.user.sub !== 'system' ? req.user.sub : null; }

function openAIToolDeclarations() {
  return toolDeclarations.map((t:any) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

async function runOpenAICompatibleAgent(deps: Deps, req: any, model: any, input: string, prompt: string, options: any, allowTools: boolean) {
  const started = Date.now();
  const messages:any[] = [{ role: 'system', content: baseSystem }, { role: 'user', content: prompt }];
  const toolsUsed:any[] = [];
  const calculations:any[] = [];
  const maxRounds = allowTools ? (FREE_TIER_MODE ? AI_FREE_TOOL_ROUNDS : Math.max(0, Math.min(3, Number(process.env.CLINAI_OPENAI_TOOL_ROUNDS || 2)))) : 0;
  let usage:any = {};
  let finalText = '';
  for (let round = 0; round <= maxRounds; round += 1) {
    const response:any = await callOpenAICompatible(model, prompt, baseSystem, responseSchema, {
      reasoning: options.mode !== 'quick' && model.provider !== 'groq',
      maxTokens: options.mode === 'quick' ? AI_QUICK_MAX_TOKENS : AI_STANDARD_MAX_TOKENS,
      tools: allowTools ? openAIToolDeclarations() : undefined,
      messages,
    });
    usage = response.usage || usage;
    const message = response.message || {};
    if (message.tool_calls?.length && round < maxRounds) {
      messages.push({ role: 'assistant', content: message.content || null, tool_calls: message.tool_calls });
      for (const tc of message.tool_calls) {
        const name = tc?.function?.name;
        let args:any = {};
        try { args = JSON.parse(tc?.function?.arguments || '{}'); } catch {}
        let result:any;
        try { result = await executeTool(name, args, deps, req); } catch (e:any) { result = { error: e?.message || `Tool ${name} failed.` }; }
        toolsUsed.push({ name, arguments: args, callId: tc.id });
        if (name === 'calculate' || name === 'analyze_dataset') calculations.push({ tool: name, operation: args.operation, result });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: aiText(result, 12000) });
      }
      continue;
    }
    finalText = response.text || message.content || '';
    break;
  }
  const structured = parseStructured(finalText) || normalizeLooseAnswer(finalText);
  return buildAgentResult(randomUUID(), structured, model.id, model.provider, options.mode || 'intelligence', started, toolsUsed, calculations, usage);
}

async function recordProviderUsage(pool: Pool | null, req: any, model: any, result: any, status: string, errorCode?: string) {
  if (!pool) return;
  try {
    await pool.query(`INSERT INTO ai_provider_usage(organization_id,provider_key,model_key,status,http_status,latency_ms,input_tokens,output_tokens,error_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.user?.organizationId || null, model.provider, model.id, status, null, result?.latencyMs || null, result?.usage?.inputTokens || null, result?.usage?.outputTokens || null, errorCode || null]);
  } catch {}
}

async function runAgent(deps: Deps, req: any, input: string, options: { purpose: string; role?: string; patientId?: string | null; mode?: string; allowResearch?: boolean; allowCodeExecution?: boolean; preferredModel?: string }) {
  const patientData = Boolean(options.patientId);
  const cacheKey = stableRequestKey({ mode: options.mode || 'intelligence', role: options.role || '', patientId: options.patientId || '', input, preferredModel: options.preferredModel || '' });
  const cached = multiModelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true };
  if (cached) multiModelCache.delete(cacheKey);

  const organizationId = deps.dbOrganizationId(req);
  const contextKey = `${organizationId || 'none'}:${options.patientId || 'facility'}:${options.mode || 'intelligence'}`;
  let context = contextCache.get(contextKey)?.value;
  if (!context || (contextCache.get(contextKey)?.expiresAt || 0) <= Date.now()) {
    // Quick requests use the smallest useful context. Full patient/facility context is reserved for intelligence/research work.
    if (options.mode === 'quick') {
      context = options.patientId ? await query(deps.pool, `SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",status,preferred_language AS "preferredLanguage" FROM patients WHERE id=$1 AND organization_id=$2`, [options.patientId, organizationId]) : { facility: 'current organization', generatedAt: new Date().toISOString() };
    } else {
      context = options.patientId ? await patientContext(deps.pool, organizationId, options.patientId) : await orgContext(deps.pool, organizationId);
    }
    contextCache.set(contextKey, { expiresAt: Date.now() + AI_CONTEXT_CACHE_MS, value: context });
  }
  let evidence: any[] = [];
  // Evidence is useful for intelligence/research, but loading it for every quick request only adds latency.
  if (options.mode !== 'quick') {
    const evidenceKey = `evidence:${organizationId || 'none'}`;
    const cachedEvidence = contextCache.get(evidenceKey);
    if (cachedEvidence && cachedEvidence.expiresAt > Date.now()) evidence = cachedEvidence.value;
    else { evidence = await approvedKnowledge(deps.pool, organizationId); contextCache.set(evidenceKey, { expiresAt: Date.now() + AI_CONTEXT_CACHE_MS, value: evidence }); }
  }
  const safeContext = patientData && !ALLOW_PUBLIC_AI_WITH_PATIENT_DATA ? redactForPublicModel(context) : context;
  const contextLimit = options.mode === 'quick' ? 7000 : (patientData && !ALLOW_PUBLIC_AI_WITH_PATIENT_DATA ? 14000 : 22000);
  const evidenceLimit = options.mode === 'quick' ? 0 : 9000;
  const prompt = `User role: ${options.role || 'healthcare professional'}\nRequested mode: ${options.mode || 'intelligence'}\nPatient-specific request: ${patientData ? 'yes' : 'no'}\n\nClinAI context:\n${aiText(safeContext, contextLimit)}${evidenceLimit ? `\n\nApproved evidence registry:\n${aiText(evidence, evidenceLimit)}` : ''}\n\nUser request:\n${input}`;

  if (!MULTI_MODEL_MODE) return runGeminiAgent(deps, req, input, options, prompt, context, evidence, cacheKey);

  const candidates: any[] = [];
  const configured = configuredProviders();
  const first = selectModel({ mode: options.mode, patientData, preferredModel: options.preferredModel, allowPublic: ALLOW_PUBLIC_AI_WITH_PATIENT_DATA });
  if (first) candidates.push(first);
  for (const m of AI_MODELS.filter(x => x.enabled && configured[x.provider] && (!patientData || !x.publicEndpoint || ALLOW_PUBLIC_AI_WITH_PATIENT_DATA)).sort((a,b)=>a.priority-b.priority)) {
    if (!candidates.some(x => x.id === m.id)) candidates.push(m);
  }

  // Gemini is kept as a provider, but its Interactions API remains the native path because it supports ClinAI's existing tool protocol.
  let lastError: any = null;
  for (const model of candidates.slice(0, AI_FALLBACK_ATTEMPTS)) {
    const started = Date.now();
    try {
      let result: any;
      if (model.provider === 'gemini') {
        result = await runGeminiAgent(deps, req, input, options, prompt, context, evidence, cacheKey, model.id);
      } else {
        const allowTools = model.toolCalling && options.mode !== 'quick' && (!patientData || ALLOW_PUBLIC_AI_WITH_PATIENT_DATA);
        result = await runOpenAICompatibleAgent(deps, req, model, input, prompt, options, allowTools);
        await recordProviderUsage(deps.pool, req, model, result, 'completed');
        await recordWork(deps.pool, req, deps.dbOrganizationId(req), options.patientId || null, { ...result, purpose: options.purpose, status: 'completed', question: input, evidenceCount: (result.structured.evidence || []).length, confidence: result.structured.confidence, resultSummary: { directAnswer: result.structured.directAnswer } });
      }
      result.provider = model.provider;
      result.fallbackChain = candidates.slice(0, AI_FALLBACK_ATTEMPTS).map(x => x.label);
      result.patientDataPolicy = patientData && !ALLOW_PUBLIC_AI_WITH_PATIENT_DATA ? 'public-models-receive-redacted context' : 'configured';
      multiModelCache.set(cacheKey, { expiresAt: Date.now() + MULTI_MODEL_CACHE_MS, result });
      return result;
    } catch (e:any) {
      lastError = e;
      try { await recordProviderUsage(deps.pool, req, model, { latencyMs: Date.now() - started }, 'failed', e?.code || String(e?.statusCode || 'PROVIDER_ERROR')); } catch {}
      continue;
    }
  }
  throw Object.assign(new Error(lastError?.message || 'No configured AI provider was able to complete this request.'), { statusCode: lastError?.statusCode || 503, code: 'AI_PROVIDER_EXHAUSTED', providerMessage: lastError?.providerMessage });
}

function redactForPublicModel(value: any): any {
  if (Array.isArray(value)) return value.map(redactForPublicModel);
  if (!value || typeof value !== 'object') return value;
  const sensitive = new Set(['firstName','middleName','lastName','phone','address','patientNumber','dateOfBirth','id','patientId','userId','organizationId','facilityId']);
  const out:any = {};
  for (const [k,v] of Object.entries(value)) out[k] = sensitive.has(k) ? '[redacted]' : redactForPublicModel(v);
  return out;
}

function runUuid() { return randomUUID(); }

function normalizeLooseAnswer(text: string): Row {
  return { directAnswer: text || 'No answer was returned.', recordedFacts: [], calculations: [], reasoningSummary: 'The provider returned an unstructured response; ClinAI preserved the response without exposing hidden reasoning.', suggestedReview: [], uncertainty: ['The response was not returned in ClinAI structured format.'], evidence: [], confidence: 'low' };
}

function buildAgentResult(runId: string, structured: Row, model: string, provider: string, mode: string, started: number, toolsUsed: any[], calculations: any[], usage?: any) {
  return { runId, answer: responseToPlain(structured, structured.directAnswer || 'ClinAI could not produce a complete answer.'), structured, model, provider, mode, toolsUsed, calculations, latencyMs: Date.now() - started, usage: { inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens }, safety: aiSafety };
}

async function runGeminiAgent(deps: Deps, req: any, input: string, options: any, prompt: string, context: any, evidence: any, cacheKey: string, selectedModel?: string) {
  const hasGemini = Boolean(GEMINI_API_KEY);
  if (!hasGemini) throw Object.assign(new Error('Gemini is not configured.'), { statusCode: 503 });
  const runId = randomUUID();
  const started = Date.now();
  const freeGemini = FREE_TIER_MODE;
  const tools: any[] = freeGemini ? [] : [...toolDeclarations];
  if (!freeGemini && options.allowResearch) tools.push({ type: 'google_search' }, { type: 'url_context' });
  if (!freeGemini && options.allowCodeExecution && ENABLE_GEMINI_CODE_EXECUTION) tools.push({ type: 'code_execution' });
  await acquireFreeTierSlot();
  const model = selectedModel || (options.mode === 'quick' ? GEMINI_FAST_MODEL : GEMINI_REASONING_MODEL);
  const history: any[] = [{ type: 'user_input', content: [{ type: 'text', text: aiText(prompt, GEMINI_FREE_MAX_INPUT_CHARS) }] }];
  let interaction: any = await geminiRequest({ model, input: history, system_instruction: baseSystem, tools, store: false, response_format: { type: 'text', mime_type: 'application/json', schema: responseSchema } });
  const toolsUsed: Row[] = [];
  const calculations: Row[] = [];
  let loop = 0;
  while (loop < GEMINI_MAX_TOOL_ROUNDS) {
    const calls = extractFunctionCalls(interaction.data);
    if (!calls.length) break;
    for (const step of interaction.data?.steps || []) history.push(step);
    const results:any[] = [];
    for (const call of calls) {
      let args:any; try { args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : (call.arguments || {}); } catch { args = {}; }
      let result:any; try { result = await executeTool(call.name, args, deps, req); } catch (error:any) { result = { error: error?.message || `Tool ${call.name} failed.` }; }
      toolsUsed.push({ name: call.name, arguments: args, callId: call.id });
      if (call.name === 'calculate' || call.name === 'analyze_dataset') calculations.push({ tool: call.name, operation: args.operation, result });
      results.push({ type: 'function_result', name: call.name, call_id: call.id, result: [{ type: 'text', text: aiText(result, 12000) }] });
    }
    history.push(...results);
    interaction = await geminiRequest({ model, input: history, system_instruction: baseSystem, tools, store: false, response_format: { type: 'text', mime_type: 'application/json', schema: responseSchema } });
    loop += 1;
  }
  const raw = extractText(interaction.data);
  const structured = parseStructured(raw) || normalizeLooseAnswer(raw);
  const result = buildAgentResult(runId, structured, model, 'gemini', options.mode || 'intelligence', started, toolsUsed, calculations);
  await recordWork(deps.pool, req, deps.dbOrganizationId(req), options.patientId || null, { ...result, purpose: options.purpose, status: 'completed', question: input, evidenceCount: (structured.evidence || []).length, confidence: structured.confidence, resultSummary: { directAnswer: structured.directAnswer } });
  return result;
}

async function geminiRequest(body: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/interactions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(body), signal: controller.signal });
  } catch (error: any) {
    const message = error?.name === 'AbortError' ? 'Gemini took too long to respond. ClinAI stopped waiting so another available intelligence provider can be tried.' : (error?.message || 'Gemini connection failed.');
    throw Object.assign(new Error(message), { statusCode: 504, code: error?.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR' });
  } finally { clearTimeout(timeout); }
  const text = await response.text();
  let data: any; try { data = JSON.parse(text); } catch { data = { error: { message: text } }; }
  if (!response.ok) {
    const rawMessage = data?.error?.message || 'Gemini request failed';
    const message = response.status === 429
      ? 'ClinAI could not reach Gemini because the configured project quota is exhausted. Free-tier mode limits ClinAI to one model request per interaction and spaces requests to reduce quota pressure. Please wait for Google quota to reset. No clinical answer was generated.'
      : rawMessage;
    const error = Object.assign(new Error(message), { statusCode: response.status, code: data?.error?.status, providerMessage: rawMessage });
    throw error;
  }
  return { data };
}

async function registerWorkAudit(pool: Pool | null, req: any, patientId: string | null, purpose: string, run: Row) {
  if (!pool) return;
  try {
    await pool.query(`INSERT INTO ai_usage_events(organization_id,user_id,patient_id,purpose,model,model_version,request_id,latency_ms,status,safety_flags,input_tokens,output_tokens) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [req.user?.organizationId || null, depsUser(req), patientId, purpose, run.model, GEMINI_API_VERSION, run.runId, run.latencyMs, 'completed', JSON.stringify([]), run.usage?.inputTokens || null, run.usage?.outputTokens || null]);
  } catch {}
}

export function registerAI(deps: Deps) {
  const { app, pool } = deps;
  app.get('/api/ai/status', async () => ({ configured: Boolean(GEMINI_API_KEY), intelligenceEngineConfigured: Boolean(INTELLIGENCE_SERVICE_URL), codeExecutionEnabled: ENABLE_GEMINI_CODE_EXECUTION, model: GEMINI_MODEL, apiVersion: GEMINI_API_VERSION, promptVersion: AI_PROMPT_VERSION, mode: FREE_TIER_MODE ? 'free-tier single-call human-reviewed intelligence' : 'tool-using human-reviewed intelligence' }));
  app.get('/api/ai/providers', async () => ({ data: { multiModelEnabled: MULTI_MODEL_MODE, publicPatientDataAllowed: ALLOW_PUBLIC_AI_WITH_PATIENT_DATA, providers: configuredProviders(), models: availableModels() } }));
  app.post('/api/ai/router', async (req:any, reply:any) => { const body=z.object({ mode:z.string().optional(), patientData:z.boolean().default(false), preferredModel:z.string().optional() }).parse(req.body||{}); const model=selectModel(body); return model ? { data:model } : reply.code(503).send({error:'No configured AI provider is available for this request.'}); });

  app.get('/api/ai/usage', async (req: any) => {
    const organizationId = deps.dbOrganizationId(req);
    if (!pool || !organizationId) return { data: {} };
    const [totals, recent] = await Promise.all([
      pool.query(`SELECT count(*)::int AS requests,coalesce(sum(input_tokens),0)::int AS "inputTokens",coalesce(sum(output_tokens),0)::int AS "outputTokens",coalesce(avg(latency_ms),0)::int AS "avgLatency" FROM ai_usage_events WHERE organization_id=$1 AND created_at>=current_date`, [organizationId]),
      pool.query(`SELECT purpose,model,status,latency_ms AS "latencyMs",created_at AS "createdAt" FROM ai_usage_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50`, [organizationId]),
    ]);
    return { data: { today: totals.rows[0], recent: recent.rows } };
  });

  app.get('/api/ai/knowledge', async (req: any) => ({ data: await approvedKnowledge(pool, deps.dbOrganizationId(req)) }));

  app.post('/api/ai/knowledge', async (req: any, reply: any) => {
    if (!pool) return reply.code(501).send({ error: 'PostgreSQL required' });
    const body = z.object({ title: z.string().min(2), jurisdiction: z.string().optional(), specialty: z.string().optional(), sourceUrl: z.string().url().optional(), version: z.string().optional(), effectiveFrom: z.string().optional(), content: z.string().min(20) }).parse(req.body || {});
    const r = await pool.query(`INSERT INTO ai_knowledge_sources(organization_id,title,jurisdiction,specialty,source_url,version,effective_from,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,title,jurisdiction,specialty,source_url AS "sourceUrl",version,effective_from AS "effectiveFrom",status`, [deps.dbOrganizationId(req), body.title, body.jurisdiction || null, body.specialty || null, body.sourceUrl || null, body.version || null, body.effectiveFrom || null, body.content]);
    return reply.code(201).send({ data: r.rows[0] });
  });

  app.get('/api/ai/attention', async (req: any) => ({ data: await proactiveAttention(pool, deps.dbOrganizationId(req)) }));

  app.get('/api/ai/brief', async (req: any) => {
    const items = await proactiveAttention(pool, deps.dbOrganizationId(req));
    const counts = items.reduce((a: Row, x: Row) => { a[x.severity] = (a[x.severity] || 0) + 1; return a; }, {});
    return { data: { counts, items: items.slice(0, 12), generatedAt: new Date().toISOString() } };
  });

  app.post('/api/ai/assist', async (req: any, reply: any) => {
    const body = z.object({ patientId: z.string().uuid().nullable().optional(), question: z.string().min(1), purpose: z.string().default('ask-clinai'), role: z.string().optional(), mode: z.enum(['quick','intelligence','analysis','research']).default('intelligence') }).parse(req.body || {});
    try {
      const result = await runAgent(deps, req, body.question, { purpose: body.purpose, role: body.role, patientId: body.patientId || null, mode: body.mode, allowResearch: body.mode === 'research', allowCodeExecution: body.mode === 'analysis' });
      await registerWorkAudit(pool, req, body.patientId || null, body.purpose, result);
      return { data: result };
    } catch (e: any) { return reply.code(e.statusCode || 502).send({ error: e.message }); }
  });

  app.post('/api/ai/patient-intelligence', async (req: any, reply: any) => {
    const body = z.object({ patientId: z.string().uuid(), question: z.string().default('What needs my attention about this patient?') }).parse(req.body || {});
    try { return { data: await runAgent(deps, req, body.question, { purpose: 'patient-intelligence', patientId: body.patientId, mode: 'intelligence' }) }; } catch (e: any) { return reply.code(e.statusCode || 502).send({ error: e.message }); }
  });

  app.post('/api/ai/compute', async (req: any, reply: any) => {
    const body = z.object({ operation: z.string().min(2), inputs: z.record(z.any()) }).parse(req.body || {});
    try { return { data: await intelligenceCompute(body.operation, body.inputs) }; } catch (e: any) { return reply.code(400).send({ error: e.message }); }
  });

  app.post('/api/ai/analyze', async (req: any, reply: any) => {
    const body = z.object({ operation: z.enum(['describe','trend','forecast','anomalies','compare']), values: z.array(z.number()).min(1), secondValues: z.array(z.number()).optional(), horizon: z.number().int().min(1).max(365).optional(), threshold: z.number().positive().optional() }).parse(req.body || {});
    try { return { data: await intelligenceDataset(body.operation, body.values, { second_values: body.secondValues, horizon: body.horizon || 1, threshold: body.threshold || 2.5 }) }; } catch (e: any) { return reply.code(400).send({ error: e.message }); }
  });

  app.post('/api/ai/research', async (req: any, reply: any) => {
    const body = z.object({ question: z.string().min(5), specialty: z.string().optional(), role: z.string().optional() }).parse(req.body || {});
    try { return { data: await runAgent(deps, req, body.question, { purpose: 'research', role: body.role, mode: 'research', allowResearch: true }) }; } catch (e: any) { return reply.code(e.statusCode || 502).send({ error: e.message }); }
  });

  app.post('/api/ai/document', async (req: any, reply: any) => {
    const body = z.object({ patientId: z.string().uuid().optional(), documentType: z.enum(['clinical-note','discharge-summary','referral-summary','patient-explanation','handover','management-brief']), sourceText: z.string().min(1) }).parse(req.body || {});
    try { return { data: await runAgent(deps, req, `Draft a ${body.documentType} from the supplied source notes. Clearly identify missing information and do not invent facts. Source notes:\n${body.sourceText}`, { purpose: `document-${body.documentType}`, patientId: body.patientId, mode: 'intelligence' }) }; } catch (e: any) { return reply.code(e.statusCode || 502).send({ error: e.message }); }
  });

  app.post('/api/ai/management-brief', async (req: any, reply: any) => {
    const body = z.object({ periodDays: z.number().int().min(1).max(365).default(30), role: z.string().default('leadership') }).parse(req.body || {});
    try {
      const result = await runAgent(deps, req, `Prepare a management briefing for the last ${body.periodDays} days. Compare the period with the preceding period where useful. Cover patient activity, appointments, waiting/flow pressure, clinical attention, referrals, facility capacity, inventory alerts, operational incidents and financial activity. Quantify important changes using deterministic calculations and clearly separate recorded facts from interpretation.`, { purpose: 'management-brief', role: body.role, mode: 'analysis', allowCodeExecution: true });
      return { data: result };
    } catch (e: any) { return reply.code(e.statusCode || 502).send({ error: e.message }); }
  });

  app.post('/api/ai/cohort', async (req: any, reply: any) => {
    if (!pool) return reply.code(501).send({ error: 'PostgreSQL required' });
    const body = z.object({ cohort: z.enum(['overdue-followup','open-referrals','critical-results','priority-tasks','immunization-due']), limit: z.number().int().min(1).max(500).default(100) }).parse(req.body || {});
    const organizationId = deps.dbOrganizationId(req);
    try {
      let rows: Row[] = [];
      if (body.cohort === 'overdue-followup') rows = await query(pool, `SELECT m.id,m.payload->>'patientId' AS "patientId",m.payload->>'reason' AS reason,m.payload->>'dueAt' AS "dueAt",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM module_records m JOIN patients p ON p.id=(m.payload->>'patientId')::uuid WHERE m.organization_id=$1 AND m.module='follow-up' AND m.status IN ('due','open') AND m.payload->>'dueAt' IS NOT NULL AND (m.payload->>'dueAt')::timestamptz<now() ORDER BY (m.payload->>'dueAt')::timestamptz LIMIT ${body.limit}`, [organizationId]);
      if (body.cohort === 'open-referrals') rows = await query(pool, `SELECT r.id,r.patient_id AS "patientId",r.destination,r.reason,r.status,r.created_at AS "createdAt",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.status NOT IN ('completed','closed') ORDER BY r.created_at LIMIT ${body.limit}`, [organizationId]);
      if (body.cohort === 'critical-results') rows = await query(pool, `SELECT lr.id,co.patient_id AS "patientId",lt.name AS "testName",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.status,p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id JOIN patients p ON p.id=co.patient_id WHERE co.organization_id=$1 AND lr.critical=true AND lr.status<>'released' ORDER BY ls.received_at LIMIT ${body.limit}`, [organizationId]);
      if (body.cohort === 'priority-tasks') rows = await query(pool, `SELECT id,patient_id AS "patientId",title,priority,status,due_at AS "dueAt" FROM care_tasks WHERE organization_id=$1 AND status='open' AND priority IN ('critical','urgent') ORDER BY CASE priority WHEN 'critical' THEN 0 ELSE 1 END,due_at NULLS LAST LIMIT ${body.limit}`, [organizationId]);
      if (body.cohort === 'immunization-due') rows = await query(pool, `SELECT i.id,i.patient_id AS "patientId",i.vaccine_name AS "vaccineName",i.dose_number AS "doseNumber",i.next_due_at AS "nextDueAt",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM immunizations i JOIN patients p ON p.id=i.patient_id WHERE i.organization_id=$1 AND i.next_due_at IS NOT NULL AND i.next_due_at<now() ORDER BY i.next_due_at LIMIT ${body.limit}`, [organizationId]);
      return { data: { cohort: body.cohort, count: rows.length, records: rows } };
    } catch (e: any) { return reply.code(400).send({ error: e.message }); }
  });

  app.post('/api/ai/role-briefing', async (req: any, reply: any) => {
    const body = z.object({ role: z.enum(['leadership','doctor','nurse','pharmacist','laboratory','manager','district']), patientId: z.string().uuid().optional() }).parse(req.body || {});
    try { return { data: await runAgent(deps, req, `Prepare a concise ${body.role} briefing. Identify the most important current facts, quantified pressures, attention items and suggested review.`, { purpose: 'role-briefing', role: body.role, patientId: body.patientId, mode: 'intelligence' }) }; } catch (e: any) { return reply.code(e.statusCode || 502).send({ error: e.message }); }
  });

  app.post('/api/ai/attention', async (req: any, reply: any) => {
    const body = z.object({ patientId: z.string().uuid().optional(), scope: z.enum(['patient','facility','district']).default('facility') }).parse(req.body || {});
    try {
      const items = await proactiveAttention(pool, deps.dbOrganizationId(req));
      const filtered = body.patientId ? items.filter(x => x.patientId === body.patientId) : items;
      return { data: { scope: body.scope, items: filtered, generatedAt: new Date().toISOString() } };
    } catch (e: any) { return reply.code(500).send({ error: e.message }); }
  });

  app.post('/api/ai/translate', async (req: any, reply: any) => {
    const body = z.object({ text: z.string().min(1), targetLanguage: z.string().min(2), patientId: z.string().uuid().optional() }).parse(req.body || {});
    try {
      const result = await runAgent(deps, req, `Translate this healthcare communication into ${body.targetLanguage}. Preserve the meaning exactly. Do not add facts or advice. Return the translation in the direct answer field. Text:\n${body.text}`, { purpose: 'translate', patientId: body.patientId, mode: 'quick' });
      return { data: { text: result.structured.directAnswer, targetLanguage: body.targetLanguage, safety: aiSafety } };
    } catch (e: any) { return reply.code(e.statusCode || 502).send({ error: e.message }); }
  });

  app.get('/api/ai/work-runs', async (req: any) => {
    if (!pool) return { data: [] };
    const rows = await query(pool, `SELECT run_id AS "runId",purpose,mode,model,status,question,tools_used AS "toolsUsed",calculations,evidence_count AS "evidenceCount",latency_ms AS "latencyMs",confidence,created_at AS "createdAt" FROM ai_work_runs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`, [deps.dbOrganizationId(req)]);
    return { data: rows };
  });

  app.get('/api/ai/evaluations', async (req: any) => ({ data: await query(pool, `SELECT id,use_case,model_version,verdict,safety_flags AS "safetyFlags",created_at AS "createdAt",reviewed_at AS "reviewedAt" FROM ai_evaluations WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`, [deps.dbOrganizationId(req)]) }));

  app.post('/api/ai/evaluations', async (req: any, reply: any) => {
    if (!pool) return reply.code(501).send({ error: 'PostgreSQL required' });
    const body = z.object({ patientId: z.string().uuid().optional(), useCase: z.string(), modelVersion: z.string().optional(), inputSummary: z.string().optional(), outputSummary: z.string().optional(), expectedResult: z.string().optional(), verdict: z.enum(['pending','pass','fail','needs-review']).default('pending'), safetyFlags: z.array(z.string()).default([]) }).parse(req.body || {});
    const r = await pool.query(`INSERT INTO ai_evaluations(organization_id,patient_id,model_version,use_case,input_summary,output_summary,expected_result,reviewer_id,verdict,safety_flags,reviewed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $9<>'pending' THEN now() END) RETURNING *`, [deps.dbOrganizationId(req), body.patientId || null, body.modelVersion || GEMINI_MODEL, body.useCase, body.inputSummary || null, body.outputSummary || null, body.expectedResult || null, depsUser(req), body.verdict, JSON.stringify(body.safetyFlags)]);
    return reply.code(201).send({ data: r.rows[0] });
  });

  app.get('/api/ai/security-model', async () => ({ data: { autonomousClinicalAction: false, humanApprovalRequiredForWrites: true, chainOfThoughtExposed: false, deterministicComputationsPreferred: true, tenantIsolation: true, auditTrail: true, researchUsesExternalSourcesOnlyWhenRequested: true } }));
}
