import type { Pool } from 'pg';

type Row = Record<string, any>;
type Query = (sql: string, params?: any[]) => Promise<Row[]>;

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await fn(); } catch { return fallback; }
};

export type CareGap = {
  id: string;
  patientId?: string | null;
  gapType: string;
  severity: 'critical' | 'urgent' | 'high' | 'routine';
  sourceModule: string;
  title: string;
  dueAt?: string | null;
  evidence: Row;
};

export async function buildPatientIntelligenceLayer(query: Query, organizationId: string, patientId: string) {
  const [criticalLabs, urgentTasks, overdueFollowups, delayedReferrals, immunizationsDue, activeRisks, recentResults, admissions, carePlans, reconciliation,
    finance, supply, publicHealth, longitudinalEvents, procedures, referrals] = await Promise.all([
    safe(() => query(`SELECT lr.id,lt.name AS "testName",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.status,ls.received_at AS "receivedAt" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id WHERE co.organization_id=$1 AND co.patient_id=$2 AND lr.critical=true AND lr.status<>'released' ORDER BY ls.received_at DESC LIMIT 10`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,title,priority,status,due_at AS "dueAt" FROM care_tasks WHERE organization_id=$1 AND patient_id=$2 AND status NOT IN ('completed','closed','cancelled') AND priority IN ('critical','urgent') ORDER BY due_at NULLS LAST LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,reason,status,due_at AS "dueAt",created_at AS "createdAt" FROM module_records WHERE organization_id=$1 AND payload->>'patientId'=$2 AND module='follow-up' AND status NOT IN ('completed','closed','cancelled') AND (payload->>'dueAt') IS NOT NULL AND (payload->>'dueAt')::timestamptz < now() ORDER BY created_at DESC LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT r.id,r.reason,r.destination,r.status,r.created_at AS "createdAt" FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE r.patient_id=$2 AND p.organization_id=$1 AND r.status NOT IN ('completed','closed','cancelled') AND r.created_at < now()-interval '7 days' ORDER BY r.created_at ASC LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,vaccine_name AS "vaccineName",dose_number AS "doseNumber",next_due_at AS "nextDueAt" FROM immunizations WHERE organization_id=$1 AND patient_id=$2 AND next_due_at IS NOT NULL AND next_due_at < now() ORDER BY next_due_at ASC LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,signal_type AS "ruleKey",severity,title,summary,created_at AS "createdAt" FROM clinical_signals WHERE organization_id=$1 AND patient_id=$2 AND status NOT IN ('resolved','closed','dismissed') ORDER BY created_at DESC LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT lr.id,lt.name AS "testName",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.status,ls.received_at AS "receivedAt" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id WHERE co.organization_id=$1 AND co.patient_id=$2 ORDER BY ls.received_at DESC LIMIT 12`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,status,ward,bed,admitted_at AS "admittedAt",discharged_at AS "dischargedAt" FROM admissions WHERE organization_id=$1 AND patient_id=$2 ORDER BY admitted_at DESC LIMIT 10`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,title,status,goals FROM care_plans WHERE patient_id=$2 AND EXISTS (SELECT 1 FROM patients p WHERE p.id=care_plans.patient_id AND p.organization_id=$1) ORDER BY id DESC LIMIT 10`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,status,medicines,discrepancies,created_at AS "createdAt" FROM medication_reconciliation WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 5`, [organizationId, patientId]), []),
    safe(() => query(`SELECT i.id,i.status,i.total,i.created_at AS "createdAt",coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='paid'),0) AS "paidAmount",coalesce(i.total,0)-coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='paid'),0) AS "balance" FROM invoices i WHERE i.organization_id=$1 AND i.patient_id=$2 ORDER BY i.created_at DESC LIMIT 30`, [organizationId, patientId]), []),
    safe(() => query(`SELECT mo.id,mo.status,mo.quantity,m.name AS "medicationName",coalesce((SELECT sum(ib.quantity) FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ii.organization_id=$1 AND lower(ii.name)=lower(m.name)),0) AS "availableQuantity" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id JOIN patients p ON p.id=mo.patient_id WHERE mo.patient_id=$2 AND p.organization_id=$1 ORDER BY mo.id DESC LIMIT 30`, [organizationId, patientId]), []),
    safe(() => query(`SELECT sc.id,sc.status,sc.case_type AS "caseType",sc.detected_at AS "detectedAt",sc.risk_level AS "riskLevel" FROM surveillance_cases sc WHERE sc.organization_id=$1 AND sc.patient_id=$2 ORDER BY sc.detected_at DESC LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT event_type AS "eventType",from_state AS "fromState",to_state AS "toState",payload,created_at AS "at",encounter_id AS "encounterId" FROM clinical_workflow_events WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at ASC LIMIT 500`, [organizationId, patientId]), []),
    safe(() => query(`SELECT pr.id,pr.status,pr.display AS "procedureType",pr.scheduled_at AS "scheduledAt",pr.performed_at AS "performedAt",pr.created_at AS "createdAt" FROM procedures pr JOIN patients p ON p.id=pr.patient_id WHERE pr.patient_id=$2 AND p.organization_id=$1 ORDER BY COALESCE(pr.performed_at,pr.scheduled_at,pr.created_at) DESC LIMIT 30`, [organizationId, patientId]), []),
    safe(() => query(`SELECT r.id,r.status,r.destination,r.reason,r.created_at AS "createdAt" FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.patient_id=$2 ORDER BY r.created_at DESC LIMIT 50`, [organizationId, patientId]), []),
  ]);

  const gaps: CareGap[] = [
    ...criticalLabs.map(x => ({ id:`lab:${x.id}`, patientId, gapType:'critical-result-review', severity:'critical' as const, sourceModule:'laboratory', title:`Critical laboratory result requires review`, evidence:x })),
    ...urgentTasks.map(x => ({ id:`task:${x.id}`, patientId, gapType:'priority-task', severity:x.priority==='critical'?'critical' as const:'urgent' as const, sourceModule:'care-tasks', title:x.title || 'Priority care task remains open', dueAt:x.dueAt, evidence:x })),
    ...overdueFollowups.map(x => ({ id:`followup:${x.id}`, patientId, gapType:'overdue-follow-up', severity:'high' as const, sourceModule:'follow-up', title:x.reason || 'Follow-up is overdue', dueAt:x.dueAt, evidence:x })),
    ...delayedReferrals.map(x => ({ id:`referral:${x.id}`, patientId, gapType:'delayed-referral', severity:'high' as const, sourceModule:'referrals', title:x.reason || `Referral to ${x.destination || 'destination'} remains open`, evidence:x })),
    ...immunizationsDue.map(x => ({ id:`immunization:${x.id}`, patientId, gapType:'immunization-due', severity:'routine' as const, sourceModule:'immunization', title:`${x.vaccineName || 'Immunization'} is overdue`, dueAt:x.nextDueAt, evidence:x })),
    ...supply.filter(x => ['active','pending','ordered'].includes(String(x.status).toLowerCase()) && Number(x.availableQuantity||0) < Number(x.quantity||0)).map(x => ({ id:`supply:${x.id}`, patientId, gapType:'medication-supply-gap', severity:'high' as const, sourceModule:'inventory', title:`Recorded medication order has insufficient currently recorded stock`, evidence:x })),
    ...finance.filter(x => Number(x.balance||0) > 0 && !['paid','cancelled','void'].includes(String(x.status).toLowerCase())).map(x => ({ id:`invoice:${x.id}`, patientId, gapType:'unpaid-encounter-balance', severity:'routine' as const, sourceModule:'finance', title:'An invoice has a recorded outstanding balance', evidence:x })),
  ];

  const riskSignals = [
    ...activeRisks.map(x => ({ source:'cdss', severity:x.severity || 'info', ...x })),
    ...gaps.filter(x => ['critical','urgent'].includes(x.severity)).map(x => ({ source:x.sourceModule, ruleKey:x.gapType, severity:x.severity, title:x.title, summary:'Deterministic cross-module care signal requiring review.' })),
  ].slice(0, 60);

  const eventTimeline = longitudinalEvents.map(x => ({ ...x, category: String(x.eventType||'').split('.')[0] || 'clinical' }));
  const currentAdmission = admissions.find(x => ['admitted','inpatient','active'].includes(String(x.status).toLowerCase())) || null;
  const outcomeSignals = [
    ...procedures.filter(x => String(x.status).toLowerCase() === 'completed').map(x => ({type:'procedure-completed', id:x.id, at:x.performedAt || x.scheduledAt})),
    ...admissions.filter(x => x.dischargedAt).map(x => ({type:'admission-discharge', id:x.id, at:x.dischargedAt})),
    ...referrals.filter(x => ['completed','closed'].includes(String(x.status).toLowerCase())).map(x => ({type:'referral-closed', id:x.id, at:x.createdAt})),
  ];

  return {
    generatedAt: new Date().toISOString(),
    contextVersion:'6.0',
    synthesis:{clinical:true,operational:true,financial:true,supply:true,publicHealth:true,longitudinal:true,careGaps:true,safety:true,outcomes:true},
    finance, supply, publicHealth, longitudinalEvents:eventTimeline, outcomes:outcomeSignals,
    careGaps: gaps.slice(0, 80), riskSignals,
    patientJourney: { currentAdmission, activeCarePlans: carePlans.filter(x => String(x.status) === 'active').length, medicationReconciliation: reconciliation[0] || null, recentResults, eventCount:eventTimeline.length },
    summary: { openCareGaps:gaps.length, criticalSignals:riskSignals.filter(x=>x.severity==='critical').length, urgentSignals:riskSignals.filter(x=>x.severity==='urgent').length, overdueFollowups:overdueFollowups.length, delayedReferrals:delayedReferrals.length, immunizationsDue:immunizationsDue.length, outstandingFinance:finance.filter(x=>Number(x.balance||0)>0).length, medicationSupplyGaps:supply.filter(x=>Number(x.availableQuantity||0)<Number(x.quantity||0)).length, publicHealthCases:publicHealth.length, longitudinalEvents:eventTimeline.length, outcomes:outcomeSignals.length }
  };
}

export async function buildClinicalVelocity(query: Query, organizationId: string, days = 30) {
  const period = Math.min(365, Math.max(1, Number(days) || 30));
  const rows = await safe(() => query(`
    WITH pairs AS (
      SELECT event_type,created_at,patient_id,
             lag(created_at) OVER (PARTITION BY patient_id ORDER BY created_at) AS previous_at
      FROM clinical_workflow_events
      WHERE organization_id=$1 AND created_at >= now()-($2::text || ' days')::interval
    )
    SELECT event_type, count(*)::int AS count,
      round(avg(extract(epoch FROM (created_at-previous_at))/60.0)::numeric,1) AS "avgMinutesFromPreviousEvent"
    FROM pairs GROUP BY event_type ORDER BY count DESC`, [organizationId, String(period)]), []);

  const metricRows = await safe(() => query(`
    SELECT
      (SELECT count(*)::int FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.joined_at>=now()-($2::text||' days')::interval AND qe.status='completed') AS "completedQueueEntries",
      (SELECT count(*)::int FROM clinical_orders WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval) AS "ordersCreated",
      (SELECT count(*)::int FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE co.organization_id=$1 AND ls.received_at>=now()-($2::text||' days')::interval) AS "resultsAvailable",
      (SELECT count(*)::int FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.created_at>=now()-($2::text||' days')::interval) AS "referralsCreated",
      (SELECT count(*)::int FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.status IN ('completed','closed') AND r.created_at>=now()-($2::text||' days')::interval) AS "referralsClosed",
      (SELECT count(*)::int FROM care_tasks WHERE organization_id=$1 AND status='completed' AND created_at>=now()-($2::text||' days')::interval) AS "tasksCompleted"
  `, [organizationId, String(period)]), [{}]);
  const actionRows = await safe(() => query(`
    WITH pairs(signal_event,action_event) AS (VALUES
      ('result.created','result.verified'),('result.verified','result.released'),('referral.created','referral.completed'),('task.created','task.completed'),('followup.due','followup.completed'),('discharge.started','followup.completed')
    )
    SELECT p.signal_event AS "signalEvent",p.action_event AS "actionEvent",count(*)::int AS "closedSignals",
      round(avg(extract(epoch FROM (a.created_at-s.created_at))/60.0)::numeric,1) AS "avgMinutesToAction",
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (a.created_at-s.created_at))/60.0)::numeric,1) AS "medianMinutesToAction"
    FROM pairs p JOIN clinical_workflow_events s ON s.organization_id=$1 AND s.event_type=p.signal_event AND s.created_at>=now()-($2::text||' days')::interval
    JOIN LATERAL (SELECT created_at FROM clinical_workflow_events a WHERE a.organization_id=s.organization_id AND a.patient_id IS NOT DISTINCT FROM s.patient_id AND a.event_type=p.action_event AND a.created_at>s.created_at ORDER BY a.created_at LIMIT 1) a ON true
    GROUP BY p.signal_event,p.action_event ORDER BY p.signal_event
  `,[organizationId,String(period)]),[]);
  

  const m = metricRows[0] || {};
  return {
    periodDays: period,
    generatedAt: new Date().toISOString(),
    metrics: {
      completedQueueEntries:Number(m.completedQueueEntries||0),
      ordersCreated:Number(m.ordersCreated||0),
      resultsAvailable:Number(m.resultsAvailable||0),
      referralsCreated:Number(m.referralsCreated||0),
      referralsClosed:Number(m.referralsClosed||0),
      referralClosureRate:m.referralsCreated ? Math.round((Number(m.referralsClosed||0)/Number(m.referralsCreated))*1000)/10 : null,
      tasksCompleted:Number(m.tasksCompleted||0),
    },
    eventProfile: rows,
    signalToAction: actionRows,
    definition: 'Clinical velocity measures elapsed time and flow from clinically meaningful signal or workflow event to the next recorded action. It is an operational intelligence measure, not a clinical quality judgment by itself.',
  };
}

export async function buildValueBasedCare(query: Query, organizationId: string, days = 30) {
  const velocity = await buildClinicalVelocity(query, organizationId, days);
  const [gaps, completedFollowups, completedReferrals, criticalResults] = await Promise.all([
    safe(() => query(`
      SELECT gap_type AS "gapType", severity, count(*)::int AS count FROM (
        SELECT 'critical-result-review' AS gap_type,'critical' AS severity FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE co.organization_id=$1 AND lr.critical=true AND lr.status<>'released'
        UNION ALL
        SELECT 'priority-task','urgent' FROM care_tasks WHERE organization_id=$1 AND status='open' AND priority IN ('critical','urgent')
        UNION ALL
        SELECT 'delayed-referral','high' FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.status NOT IN ('completed','closed','cancelled') AND r.created_at<now()-interval '7 days'
        UNION ALL
        SELECT 'immunization-due','routine' FROM immunizations WHERE organization_id=$1 AND next_due_at IS NOT NULL AND next_due_at<now()
      ) gaps GROUP BY gap_type,severity ORDER BY count DESC`, [organizationId]), []),
    safe(() => query(`SELECT count(*)::int AS count FROM module_records WHERE organization_id=$1 AND module='follow-up' AND status IN ('completed','closed') AND updated_at>=now()-($2::text||' days')::interval`, [organizationId, String(days)]), [{}]),
    safe(() => query(`SELECT count(*)::int AS count FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.status IN ('completed','closed') AND r.created_at>=now()-($2::text||' days')::interval`, [organizationId, String(days)]), [{}]),
    safe(() => query(`SELECT count(*)::int AS count FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE co.organization_id=$1 AND lr.critical=true AND lr.status='released' AND ls.received_at>=now()-($2::text||' days')::interval`, [organizationId, String(days)]), [{}]),
  ]);
  return {
    periodDays:Number(days)||30,
    generatedAt:new Date().toISOString(),
    careGapProfile:gaps,
    outcomes:{completedFollowups:Number(completedFollowups[0]?.count||0),completedReferrals:Number(completedReferrals[0]?.count||0),criticalResultsReleased:Number(criticalResults[0]?.count||0)},
    velocity,
    framework:{measurement:'FHIR Measure/CQL-compatible definitions',guidelineSpine:'WHO SMART Guidelines',interpretation:'Use measures to identify improvement opportunities; do not treat operational proxies as patient outcomes without clinical validation.'},
  };
}

export async function buildGovernanceSummary(query: Query, organizationId: string) {
  const [capabilities, risks, security, evals] = await Promise.all([
    safe(() => query(`SELECT capability_id AS "capabilityId",name,domain,risk_level AS "riskLevel",status,version FROM ai_capabilities WHERE organization_id=$1 OR organization_id IS NULL ORDER BY domain,capability_id`, [organizationId]), []),
    safe(() => query(`SELECT risk_level AS "riskLevel",risk_type AS "riskType",status,count(*)::int AS count FROM ai_risk_assessments WHERE organization_id=$1 GROUP BY risk_level,risk_type,status ORDER BY count DESC`, [organizationId]), []),
    safe(() => query(`SELECT severity,event_type AS "eventType",status,count(*)::int AS count FROM ai_security_events WHERE organization_id=$1 AND created_at>=now()-interval '30 days' GROUP BY severity,event_type,status ORDER BY count DESC`, [organizationId]), []),
    safe(() => query(`SELECT verdict,count(*)::int AS count FROM ai_evaluations WHERE organization_id=$1 GROUP BY verdict`, [organizationId]), []),
  ]);
  return { generatedAt:new Date().toISOString(), capabilities, risks, securityEvents:security, evaluations:evals, controls:{humanReviewRequired:true,autonomousClinicalWrites:false,tenantIsolation:true,patientLevelAuthorization:true,providerPolicyEnforced:true,provenanceRequired:true} };
}

export async function recordSecurityEvent(pool: Pool | null, input: {organizationId:string;userId?:string|null;patientId?:string|null;capabilityId?:string|null;eventType:string;severity?:string;status?:string;metadata?:Row}) {
  if (!pool || !input.organizationId) return null;
  const r = await pool.query(`INSERT INTO ai_security_events(organization_id,user_id,patient_id,capability_id,event_type,severity,status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at AS "createdAt"`, [input.organizationId,input.userId||null,input.patientId||null,input.capabilityId||null,input.eventType,input.severity||'info',input.status||'observed',JSON.stringify(input.metadata||{})]);
  return r.rows[0] || null;
}

export const AI_CAPABILITY_CATALOG = [
  { capabilityId:'patient-cross-module-synthesis', riskLevel:'level-3', domain:'clinical-intelligence' },
  { capabilityId:'clinical-velocity', riskLevel:'level-2', domain:'operations' },
  { capabilityId:'care-gap-detection', riskLevel:'level-2', domain:'value-based-care' },
  { capabilityId:'clinical-documentation', riskLevel:'level-3', domain:'documentation' },
  { capabilityId:'medication-safety', riskLevel:'level-1', domain:'medication-safety' },
  { capabilityId:'diagnostic-support', riskLevel:'level-3', domain:'diagnostic-support' },
  { capabilityId:'population-intelligence', riskLevel:'level-2', domain:'population-health' },
  { capabilityId:'ai-security-monitoring', riskLevel:'level-2', domain:'security' },
] as const;

export async function calculateClinicalMeasures(query: Query, organizationId: string, start: string, end: string) {
  const rows = await safe(() => query(`
    SELECT
      $2::date AS "periodStart", $3::date AS "periodEnd",
      (SELECT count(*)::numeric FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.created_at::date BETWEEN $2::date AND $3::date AND r.status IN ('completed','closed')) AS referral_num,
      (SELECT count(*)::numeric FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.created_at::date BETWEEN $2::date AND $3::date) AS referral_den,
      (SELECT count(*)::numeric FROM module_records WHERE organization_id=$1 AND module='follow-up' AND status IN ('completed','closed') AND (payload->>'dueAt') IS NOT NULL AND updated_at::date BETWEEN $2::date AND $3::date AND updated_at <= (payload->>'dueAt')::timestamptz) AS followup_num,
      (SELECT count(*)::numeric FROM module_records WHERE organization_id=$1 AND module='follow-up' AND (payload->>'dueAt') IS NOT NULL AND updated_at::date BETWEEN $2::date AND $3::date) AS followup_den,
      (SELECT count(*)::numeric FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE co.organization_id=$1 AND lr.critical=true AND lr.status='released' AND ls.received_at::date BETWEEN $2::date AND $3::date) AS critical_release_num,
      (SELECT count(*)::numeric FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE co.organization_id=$1 AND lr.critical=true AND ls.received_at::date BETWEEN $2::date AND $3::date AND lr.status IN ('verified','released')) AS critical_release_den
  `, [organizationId, start, end]), [{}]);
  const r = rows[0] || {};
  const ratio = (n:any,d:any) => Number(d||0) ? Math.round((Number(n||0)/Number(d))*10000)/100 : null;
  return [
    { measureCode:'CLINAI-REFERRAL-CLOSURE-7D', numerator:Number(r.referral_num||0), denominator:Number(r.referral_den||0), valueNumeric:ratio(r.referral_num,r.referral_den) },
    { measureCode:'CLINAI-FOLLOWUP-CLOSURE', numerator:Number(r.followup_num||0), denominator:Number(r.followup_den||0), valueNumeric:ratio(r.followup_num,r.followup_den) },
    { measureCode:'CLINAI-CRITICAL-RESULT-ACK', numerator:Number(r.critical_release_num||0), denominator:Number(r.critical_release_den||0), valueNumeric:ratio(r.critical_release_num,r.critical_release_den) },
  ];
}

export async function buildAIGovernanceLifecycle(query: Query, organizationId: string) {
  const [capabilities,evaluations,incidents,lifecycle] = await Promise.all([
    safe(() => query(`SELECT capability_id AS "capabilityId",name,domain,risk_level AS "riskLevel",status,version FROM ai_capabilities WHERE organization_id=$1 OR organization_id IS NULL ORDER BY domain,capability_id`,[organizationId]),[]),
    safe(() => query(`SELECT capability_id AS "capabilityId",evaluation_type AS "evaluationType",status,count(*)::int AS count FROM ai_capability_evaluations WHERE organization_id=$1 GROUP BY capability_id,evaluation_type,status ORDER BY capability_id`,[organizationId]),[]),
    safe(() => query(`SELECT severity,status,incident_type AS "incidentType",count(*)::int AS count FROM ai_incidents WHERE organization_id=$1 GROUP BY severity,status,incident_type ORDER BY count DESC`,[organizationId]),[]),
    safe(() => query(`SELECT model_id AS "modelId",event_type AS "eventType",environment,outcome,count(*)::int AS count FROM ai_model_lifecycle_events WHERE organization_id=$1 GROUP BY model_id,event_type,environment,outcome ORDER BY count DESC`,[organizationId]),[]),
  ]);
  return { generatedAt:new Date().toISOString(), catalog:AI_CAPABILITY_CATALOG, capabilities, evaluations, incidents, lifecycle, lifecycleStates:['design','evaluation','validation','approval','production','monitoring','incident','containment','corrective-action','re-evaluation','retirement'], riskLevels:['level-1','level-2','level-3'] };
}

export async function recordAICapabilityEvaluation(pool: Pool | null, input: {organizationId:string;capabilityId:string;version?:string;evaluationType:string;status?:string;sampleSize?:number;metrics?:Row;findings?:Row;reviewerId?:string|null}) {
  if(!pool) return null;
  const r=await pool.query(`INSERT INTO ai_capability_evaluations(organization_id,capability_id,version,evaluation_type,status,sample_size,metrics,findings,reviewer_id,evaluated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $5 IN ('passed','failed','reviewed') THEN now() ELSE NULL END) RETURNING id,created_at AS "createdAt"`,[input.organizationId,input.capabilityId,input.version||'1.0',input.evaluationType,input.status||'pending',input.sampleSize||null,JSON.stringify(input.metrics||{}),JSON.stringify(input.findings||{}),input.reviewerId||null]);
  return r.rows[0]||null;
}

export async function buildPatient360Context(query: Query, organizationId: string, patientId: string, task = 'clinical') {
  const base: Row = await buildPatientIntelligenceLayer(query, organizationId, patientId);
  const t = task.toLowerCase();
  const profiles: Record<string,string[]> = {
    medication:['medications','reconciliation','supply','riskSignals','careGaps','events'],
    finance:['finance','events'], billing:['finance','events'],
    surgery:['patientJourney','events','careGaps','riskSignals','outcomes'],
    'surgical follow-up':['patientJourney','events','careGaps','riskSignals','outcomes'],
    pharmacy:['medications','reconciliation','supply','riskSignals','events'],
    publichealth:['publicHealth','events','riskSignals','careGaps'],
  };
  const selected = profiles[t] || ['patientJourney','careGaps','riskSignals','events','outcomes'];
  const context:any = {contextVersion:base.contextVersion, purpose:t, generatedAt:base.generatedAt};
  for (const key of selected) if (Object.prototype.hasOwnProperty.call(base,key)) context[key]=base[key];
  context.synthesis = {clinical:t==='clinical'||selected.includes('patientJourney'), operational:selected.includes('patientJourney')||t==='clinical', financial:selected.includes('finance'), supply:selected.includes('supply'), publicHealth:selected.includes('publicHealth'), longitudinal:selected.includes('events'), careGaps:selected.includes('careGaps'), safety:selected.includes('riskSignals'), outcomes:selected.includes('outcomes')};
  context.minimumNecessary = true;
  return context;
}

export async function buildAISecurityIntelligence(query: Query, organizationId: string, days=30) {
  const d=Math.min(365,Math.max(1,Number(days)||30));
  const [events,trend,controls] = await Promise.all([
    safe(()=>query(`SELECT event_type AS "eventType",severity,status,source,count(*)::int AS count FROM ai_security_events WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval GROUP BY event_type,severity,status,source ORDER BY count DESC`,[organizationId,String(d)]),[]),
    safe(()=>query(`SELECT created_at::date AS date,severity,count(*)::int AS count FROM ai_security_events WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval GROUP BY created_at::date,severity ORDER BY date`,[organizationId,String(d)]),[]),
    safe(()=>query(`SELECT event_type AS "eventType",count(*)::int AS count FROM ai_security_events WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval GROUP BY event_type ORDER BY count DESC`,[organizationId,String(d)]),[])
  ]);
  const controlCatalog=['prompt-injection','indirect-injection','data-disclosure','cross-tenant-access','role-spoofing','unauthorized-patient-lookup','tool-misuse','provider-leakage','unsafe-output','abuse-rate-limit'];
  const observed=new Set(events.map(x=>String(x.eventType)));
  return {periodDays:d,generatedAt:new Date().toISOString(),events,trend,controls:controlCatalog.map(control=>({control,observed:observed.has(control),status:observed.has(control)?'monitored':'no-events-recorded'})),policy:{tenantIsolation:true,serverDerivedRole:true,patientAuthorization:true,providerLeakageBlocked:true,unsafeOutputBlocked:true,rateLimitsEnforced:true}};
}

export async function buildAIRiskIntelligence(query: Query, organizationId: string) {
  const [matrix,assessments,incidents,review] = await Promise.all([
    safe(()=>query(`SELECT risk_level AS "riskLevel",risk_type AS "riskType",status,count(*)::int AS count FROM ai_risk_assessments WHERE organization_id=$1 GROUP BY risk_level,risk_type,status ORDER BY risk_level,risk_type,status`,[organizationId]),[]),
    safe(()=>query(`SELECT id,capability_id AS "capabilityId",risk_level AS "riskLevel",risk_type AS "riskType",status,source,findings,mitigations,reviewed_at AS "reviewedAt",created_at AS "createdAt" FROM ai_risk_assessments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 200`,[organizationId]),[]),
    safe(()=>query(`SELECT id,capability_id AS "capabilityId",severity,status,incident_type AS "incidentType",description,containment,corrective_action AS "correctiveAction",resolved_at AS "resolvedAt",created_at AS "createdAt" FROM ai_incidents WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`,[organizationId]),[]),
    safe(()=>query(`SELECT capability_id AS "capabilityId",max(reviewed_at) AS "lastReview" FROM ai_risk_assessments WHERE organization_id=$1 GROUP BY capability_id`,[organizationId]),[])
  ]);
  return {generatedAt:new Date().toISOString(),riskMatrix:matrix,assessments,incidents,review,workflow:['risk-classification','evaluation','clinical-validation','approval','monitoring','drift','incident','mitigation','residual-risk','review','retirement']};
}

export async function buildClinicalVelocityIntelligence(query: Query, organizationId: string, days=30) {
  const d=Math.min(365,Math.max(1,Number(days)||30));
  const rows=await safe(()=>query(`WITH signals AS (SELECT id,event_type,patient_id,created_at,CASE WHEN event_type LIKE '%critical%' THEN 'critical' WHEN event_type LIKE '%urgent%' THEN 'urgent' ELSE 'routine' END severity FROM clinical_workflow_events WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval), actions AS (SELECT s.id,s.event_type,s.patient_id,s.created_at,MIN(a.created_at) action_at,s.severity FROM signals s LEFT JOIN clinical_workflow_events a ON a.organization_id=$1 AND a.patient_id IS NOT DISTINCT FROM s.patient_id AND a.created_at>s.created_at AND a.event_type IN ('result.verified','result.released','task.completed','referral.completed','followup.completed') GROUP BY s.id,s.event_type,s.patient_id,s.created_at,s.severity) SELECT severity,count(*)::int total,count(*) FILTER(WHERE action_at IS NOT NULL)::int completed,count(*) FILTER(WHERE action_at IS NULL)::int unresolved,round(avg(extract(epoch FROM(action_at-created_at))/60.0) FILTER(WHERE action_at IS NOT NULL)::numeric,1) average_minutes,round(percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM(action_at-created_at))/60.0) FILTER(WHERE action_at IS NOT NULL)::numeric,1) median_minutes,round(percentile_cont(0.9) WITHIN GROUP(ORDER BY extract(epoch FROM(action_at-created_at))/60.0) FILTER(WHERE action_at IS NOT NULL)::numeric,1) p90_minutes FROM actions GROUP BY severity ORDER BY severity`,[organizationId,String(d)]),[]);
  const unsafe=await safe(()=>query(`SELECT count(*)::int AS count FROM clinical_signals WHERE organization_id=$1 AND severity IN ('critical','urgent') AND status NOT IN ('resolved','closed','dismissed')`,[organizationId]),[{}]);
  return {periodDays:d,generatedAt:new Date().toISOString(),metrics:rows,unresolvedSignals:Number(unsafe[0]?.count||0),bottleneck:rows.sort((a,b)=>Number(b.average_minutes||0)-Number(a.average_minutes||0))[0]||null,guardrails:{unsafeSpeedNeverRewarded:true,qualitySignalsRequired:true,patientImpactConsidered:true}};
}

export async function buildValueBasedCareIntelligence(query: Query, organizationId: string, start?:string, end?:string) {
  const e=end||new Date().toISOString().slice(0,10), s=start||new Date(Date.now()-29*86400000).toISOString().slice(0,10);
  const measures=await calculateClinicalMeasures(query,organizationId,s,e);
  const definitions=await safe(()=>query(`SELECT measure_code AS "measureCode",name,domain,numerator_definition AS "numeratorDefinition",denominator_definition AS "denominatorDefinition",logic_language AS "logicLanguage",jurisdiction,status,version FROM value_measure_definitions WHERE organization_id=$1 OR organization_id IS NULL ORDER BY domain,measure_code`,[organizationId]),[]);
  const requested=['hypertension-followup','diabetes-monitoring','immunization','anc-continuity','pnc','chronic-care','critical-result-closure','referral-completion','readmission','appointment-continuity'];
  const supported=definitions.map(x=>String(x.measureCode).toLowerCase());
  return {period:{start:s,end:e},generatedAt:new Date().toISOString(),population:{logic:'computable eligibility and numerator/denominator definitions',patientLevelAuthorizationRequired:true},measures,definitions,coverage:requested.map(name=>({measure:name,computable:supported.some(x=>x.includes(name.split('-')[0]))})),outcomeRule:'Operational completion is not treated as a clinical outcome without clinical validation.'};
}
