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
  const [criticalLabs, urgentTasks, overdueFollowups, delayedReferrals, immunizationsDue, activeRisks, recentResults, admissions, carePlans, reconciliation] = await Promise.all([
    safe(() => query(`SELECT lr.id,lt.name AS "testName",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.status,ls.received_at AS "receivedAt" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id WHERE co.organization_id=$1 AND co.patient_id=$2 AND lr.critical=true AND lr.status<>'released' ORDER BY ls.received_at DESC LIMIT 10`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,title,priority,status,due_at AS "dueAt" FROM care_tasks WHERE organization_id=$1 AND patient_id=$2 AND status NOT IN ('completed','closed','cancelled') AND priority IN ('critical','urgent') ORDER BY due_at NULLS LAST LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,reason,status,due_at AS "dueAt",created_at AS "createdAt" FROM module_records WHERE organization_id=$1 AND payload->>'patientId'=$2 AND module='follow-up' AND status NOT IN ('completed','closed','cancelled') AND (payload->>'dueAt') IS NOT NULL AND (payload->>'dueAt')::timestamptz < now() ORDER BY created_at DESC LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT r.id,r.reason,r.destination,r.status,r.created_at AS "createdAt" FROM referrals r WHERE r.organization_id=$1 AND r.patient_id=$2 AND r.status NOT IN ('completed','closed','cancelled') AND r.created_at < now()-interval '7 days' ORDER BY r.created_at ASC LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,vaccine_name AS "vaccineName",dose_number AS "doseNumber",next_due_at AS "nextDueAt" FROM immunizations WHERE organization_id=$1 AND patient_id=$2 AND next_due_at IS NOT NULL AND next_due_at < now() ORDER BY next_due_at ASC LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,signal_type AS "ruleKey",severity,title,summary,created_at AS "createdAt" FROM clinical_signals WHERE organization_id=$1 AND patient_id=$2 AND status NOT IN ('resolved','closed','dismissed') ORDER BY created_at DESC LIMIT 20`, [organizationId, patientId]), []),
    safe(() => query(`SELECT lr.id,lt.name AS "testName",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.status,ls.received_at AS "receivedAt" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id WHERE co.organization_id=$1 AND co.patient_id=$2 ORDER BY ls.received_at DESC LIMIT 12`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,status,ward,bed,admitted_at AS "admittedAt",discharged_at AS "dischargedAt" FROM admissions WHERE organization_id=$1 AND patient_id=$2 ORDER BY admitted_at DESC LIMIT 10`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,title,status,goals FROM care_plans WHERE organization_id=$1 AND patient_id=$2 ORDER BY updated_at DESC LIMIT 10`, [organizationId, patientId]), []),
    safe(() => query(`SELECT id,status,medicines,discrepancies,created_at AS "createdAt" FROM medication_reconciliation WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 5`, [organizationId, patientId]), []),
  ]);

  const gaps: CareGap[] = [
    ...criticalLabs.map(x => ({ id:`lab:${x.id}`, patientId, gapType:'critical-result-review', severity:'critical' as const, sourceModule:'laboratory', title:`Critical laboratory result requires review`, evidence:x })),
    ...urgentTasks.map(x => ({ id:`task:${x.id}`, patientId, gapType:'priority-task', severity:x.priority==='critical'?'critical' as const:'urgent' as const, sourceModule:'care-tasks', title:x.title || 'Priority care task remains open', dueAt:x.dueAt, evidence:x })),
    ...overdueFollowups.map(x => ({ id:`followup:${x.id}`, patientId, gapType:'overdue-follow-up', severity:'high' as const, sourceModule:'follow-up', title:x.reason || 'Follow-up is overdue', dueAt:x.dueAt, evidence:x })),
    ...delayedReferrals.map(x => ({ id:`referral:${x.id}`, patientId, gapType:'delayed-referral', severity:'high' as const, sourceModule:'referrals', title:x.reason || `Referral to ${x.destination || 'destination'} remains open`, evidence:x })),
    ...immunizationsDue.map(x => ({ id:`immunization:${x.id}`, patientId, gapType:'immunization-due', severity:'routine' as const, sourceModule:'immunization', title:`${x.vaccineName || 'Immunization'} is overdue`, dueAt:x.nextDueAt, evidence:x })),
  ];

  const riskSignals = [
    ...activeRisks.map(x => ({ source:'cdss', ...x })),
    ...gaps.filter(x => x.severity === 'critical' || x.severity === 'urgent').map(x => ({ source:x.sourceModule, ruleKey:x.gapType, severity:x.severity, title:x.title, summary:'Deterministic cross-module care signal requiring review.' })),
  ].slice(0, 40);

  const journey = {
    currentAdmission: admissions.find(x => ['admitted','inpatient','active'].includes(String(x.status))) || null,
    activeCarePlans: carePlans.filter(x => String(x.status) === 'active').length,
    medicationReconciliation: reconciliation[0] || null,
    recentResults,
  };

  return {
    generatedAt: new Date().toISOString(),
    careGaps: gaps.slice(0, 60),
    riskSignals,
    patientJourney: journey,
    summary: {
      openCareGaps: gaps.length,
      criticalSignals: riskSignals.filter(x => x.severity === 'critical').length,
      urgentSignals: riskSignals.filter(x => x.severity === 'urgent').length,
      overdueFollowups: overdueFollowups.length,
      delayedReferrals: delayedReferrals.length,
      immunizationsDue: immunizationsDue.length,
    },
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
      (SELECT count(*)::int FROM referrals WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval) AS "referralsCreated",
      (SELECT count(*)::int FROM referrals WHERE organization_id=$1 AND status IN ('completed','closed') AND created_at>=now()-($2::text||' days')::interval) AS "referralsClosed",
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
        SELECT 'delayed-referral','high' FROM referrals WHERE organization_id=$1 AND status NOT IN ('completed','closed','cancelled') AND created_at<now()-interval '7 days'
        UNION ALL
        SELECT 'immunization-due','routine' FROM immunizations WHERE organization_id=$1 AND next_due_at IS NOT NULL AND next_due_at<now()
      ) gaps GROUP BY gap_type,severity ORDER BY count DESC`, [organizationId]), []),
    safe(() => query(`SELECT count(*)::int AS count FROM module_records WHERE organization_id=$1 AND module='follow-up' AND status IN ('completed','closed') AND updated_at>=now()-($2::text||' days')::interval`, [organizationId, String(days)]), [{}]),
    safe(() => query(`SELECT count(*)::int AS count FROM referrals WHERE organization_id=$1 AND status IN ('completed','closed') AND updated_at>=now()-($2::text||' days')::interval`, [organizationId, String(days)]), [{}]),
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
      (SELECT count(*)::numeric FROM referrals WHERE organization_id=$1 AND created_at::date BETWEEN $2::date AND $3::date AND status IN ('completed','closed') AND updated_at <= created_at + interval '7 days') AS referral_num,
      (SELECT count(*)::numeric FROM referrals WHERE organization_id=$1 AND created_at::date BETWEEN $2::date AND $3::date) AS referral_den,
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
  return { generatedAt:new Date().toISOString(), catalog:AI_CAPABILITY_CATALOG, capabilities, evaluations, incidents, lifecycle, lifecycleStates:['design','evaluation','validated','production','monitoring','incident','retirement'], riskLevels:['level-1','level-2','level-3'] };
}

export async function recordAICapabilityEvaluation(pool: Pool | null, input: {organizationId:string;capabilityId:string;version?:string;evaluationType:string;status?:string;sampleSize?:number;metrics?:Row;findings?:Row;reviewerId?:string|null}) {
  if(!pool) return null;
  const r=await pool.query(`INSERT INTO ai_capability_evaluations(organization_id,capability_id,version,evaluation_type,status,sample_size,metrics,findings,reviewer_id,evaluated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $5 IN ('passed','failed','reviewed') THEN now() ELSE NULL END) RETURNING id,created_at AS "createdAt"`,[input.organizationId,input.capabilityId,input.version||'1.0',input.evaluationType,input.status||'pending',input.sampleSize||null,JSON.stringify(input.metrics||{}),JSON.stringify(input.findings||{}),input.reviewerId||null]);
  return r.rows[0]||null;
}
