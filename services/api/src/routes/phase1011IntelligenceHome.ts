import { z } from 'zod';
import type { Pool } from 'pg';

export type Phase1011Deps = {
  dbOrganizationId:(req:any)=>string|null;
  dbUserId:(req:any)=>string|null;
  requireAuthorizedWrite:(req:any)=>void;
  dbAudit:(...args:any[])=>Promise<any>;
};

const WORKSPACES = new Set(['patient-360','clinical-velocity','value-based-care','ai-risk','ai-security','ai-governance','ai-evaluations','care-gaps','district-intelligence']);
const ACTIONS = new Set(['acknowledge','review','dismiss','resolve','escalate']);
const safeNum=(v:any)=>Number(v||0);

export function registerPhase1011Routes(app:any,pool:Pool|null,deps:Phase1011Deps){
  const org=(req:any)=>deps.dbOrganizationId(req);

  app.get('/api/phase10/intelligence/:workspace', async (req:any, reply:any)=>{
    if(!pool)return reply.code(503).send({error:'Intelligence is temporarily unavailable.'});
    const organizationId=org(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required.'});
    const workspace=String(req.params.workspace||'').toLowerCase(); if(!WORKSPACES.has(workspace))return reply.code(404).send({error:'Intelligence workspace not found.'});
    const days=Math.min(365,Math.max(1,Number(req.query?.days||30)));
    try{
      if(workspace==='patient-360'){
        const patientId=req.query?.patientId?String(req.query.patientId):'';
        if(!patientId)return reply.code(400).send({error:'A patientId is required for Patient 360.'});
        const p=await pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,status FROM patients WHERE organization_id=$1 AND id=$2 LIMIT 1`,[organizationId,patientId]);
        if(!p.rowCount)return reply.code(404).send({error:'Patient could not be found in the authorized organization.'});
        const [events,diagnoses,notes,orders,labs,imaging,meds,recon,referrals,admissions,beds,nursing,surgery,maternity,pediatrics,chronic,insurance,invoices,payments,gaps,signals]=await Promise.all([
          pool.query(`SELECT event_type AS "eventType",from_state AS "fromState",to_state AS "toState",payload,created_at AS "at",encounter_id AS "encounterId" FROM clinical_workflow_events WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 150`,[organizationId,patientId]),
          pool.query(`SELECT id,code,display,diagnosis_type AS "diagnosisType",status,created_at AS "createdAt" FROM diagnoses WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 40`,[organizationId,patientId]),
          pool.query(`SELECT id,note_type AS "noteType",assessment,plan,created_at AS "createdAt" FROM clinical_notes cn JOIN encounters e ON e.id=cn.encounter_id WHERE e.organization_id=$1 AND e.patient_id=$2 ORDER BY cn.created_at DESC LIMIT 30`,[organizationId,patientId]),
          pool.query(`SELECT id,order_type AS "orderType",priority,status,details,created_at AS "createdAt" FROM clinical_orders WHERE patient_id=$1 AND EXISTS(SELECT 1 FROM patients p WHERE p.id=clinical_orders.patient_id AND p.organization_id=$2) ORDER BY created_at DESC LIMIT 50`,[patientId,organizationId]),
          pool.query(`SELECT lr.id,lt.name AS "testName",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status,ls.received_at AS "receivedAt" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN lab_tests lt ON lt.id=lr.test_id JOIN clinical_orders co ON co.id=ls.order_id WHERE co.patient_id=$1 AND EXISTS(SELECT 1 FROM patients p WHERE p.id=co.patient_id AND p.organization_id=$2) ORDER BY ls.received_at DESC LIMIT 50`,[patientId,organizationId]),
          pool.query(`SELECT id,study_name AS "studyName",modality,status,critical,performed_at AS "performedAt",report,impression FROM imaging_studies WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 40`,[organizationId,patientId]),
          pool.query(`SELECT mo.id,m.name AS "medicationName",mo.dose,mo.frequency,mo.route,mo.quantity,mo.status,mo.prescribed_at AS "prescribedAt" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id WHERE mo.patient_id=$1 AND EXISTS(SELECT 1 FROM patients p WHERE p.id=mo.patient_id AND p.organization_id=$2) ORDER BY mo.prescribed_at DESC LIMIT 50`,[patientId,organizationId]),
          pool.query(`SELECT id,status,medicines,discrepancies,created_at AS "createdAt" FROM medication_reconciliation WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 10`,[organizationId,patientId]),
          pool.query(`SELECT id,destination,reason,urgency,status,requested_at AS "requestedAt",accepted_at AS "acceptedAt",completed_at AS "completedAt" FROM referrals r WHERE EXISTS(SELECT 1 FROM patients p WHERE p.id=r.patient_id AND p.organization_id=$1) AND r.patient_id=$2 ORDER BY COALESCE(requested_at,created_at) DESC LIMIT 40`,[organizationId,patientId]),
          pool.query(`SELECT id,ward,bed,status,admitted_at AS "admittedAt",discharged_at AS "dischargedAt" FROM admissions WHERE organization_id=$1 AND patient_id=$2 ORDER BY admitted_at DESC LIMIT 20`,[organizationId,patientId]),
          pool.query(`SELECT id,facility_id AS "facilityId",ward,room,bed_number AS "bedNumber",bed_type AS "bedType",status,observed_at AS "observedAt" FROM facility_beds WHERE organization_id=$1 AND patient_id=$2 ORDER BY observed_at DESC LIMIT 10`,[organizationId,patientId]),
          pool.query(`SELECT id,assessment_type AS "assessmentType",findings,pain_score AS "painScore",risk_flags AS "riskFlags",status,created_at AS "createdAt" FROM nursing_assessments WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 20`,[organizationId,patientId]),
          pool.query(`SELECT id,procedure_name AS "procedureName",scheduled_at AS "scheduledAt",status,consent_confirmed AS "consentConfirmed",performed_at AS "performedAt" FROM surgery_cases WHERE organization_id=$1 AND patient_id=$2 ORDER BY COALESCE(scheduled_at,created_at) DESC LIMIT 20`,[organizationId,patientId]),
          pool.query(`SELECT id,event_type AS "eventType",gestational_age_weeks AS "gestationalAgeWeeks",status,event_at AS "eventAt" FROM maternity_records WHERE organization_id=$1 AND patient_id=$2 ORDER BY event_at DESC LIMIT 20`,[organizationId,patientId]),
          pool.query(`SELECT id,age_months AS "ageMonths",weight_kg AS "weightKg",height_cm AS "heightCm",nutrition_status AS "nutritionStatus",referral_required AS "referralRequired",created_at AS "createdAt" FROM pediatric_assessments WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 20`,[organizationId,patientId]),
          pool.query(`SELECT id,condition_name AS "conditionName",status,goals,created_at AS "createdAt" FROM chronic_care_records WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 20`,[organizationId,patientId]),
          pool.query(`SELECT ip.id,ip.policy_number AS "policyNumber",ip.status,ip.provider_id AS "providerId" FROM insurance_policies ip WHERE ip.organization_id=$1 AND ip.patient_id=$2 ORDER BY ip.created_at DESC LIMIT 10`,[organizationId,patientId]),
          pool.query(`SELECT i.id,i.status,i.total,i.created_at AS "createdAt",COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='paid'),0) AS paid,COALESCE(i.total,0)-COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='paid'),0) AS balance FROM invoices i WHERE i.organization_id=$1 AND i.patient_id=$2 ORDER BY i.created_at DESC LIMIT 30`,[organizationId,patientId]),
          pool.query(`SELECT p.id,p.amount,p.status,p.paid_at AS "paidAt",p.invoice_id AS "invoiceId" FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.organization_id=$1 AND i.patient_id=$2 ORDER BY p.paid_at DESC LIMIT 30`,[organizationId,patientId]),
          pool.query(`SELECT id,gap_type AS "gapType",severity,status,source_module AS "sourceModule",evidence,detected_at AS "detectedAt",closed_at AS "closedAt" FROM care_gap_snapshots WHERE organization_id=$1 AND patient_id=$2 ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,detected_at DESC LIMIT 50`,[organizationId,patientId]),
          pool.query(`SELECT id,signal_type AS "signalType",severity,status,title,summary,evidence,recommendation,detected_at AS "detectedAt",acknowledged_at AS "acknowledgedAt",resolved_at AS "resolvedAt" FROM clinical_signals WHERE organization_id=$1 AND patient_id=$2 ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,detected_at DESC LIMIT 50`,[organizationId,patientId])
        ]);
        return {data:{workspace,patient:p.rows[0],timeline:events.rows,diagnoses:diagnoses.rows,notes:notes.rows,orders:orders.rows,laboratory:labs.rows,imaging:imaging.rows,medications:meds.rows,reconciliation:recon.rows,referrals:referrals.rows,admissions:admissions.rows,beds:beds.rows,nursing:nursing.rows,surgery:surgery.rows,maternity:maternity.rows,pediatrics:pediatrics.rows,chronicCare:chronic.rows,insurance:insurance.rows,finance:{invoices:invoices.rows,payments:payments.rows},careGaps:gaps.rows,clinicalSignals:signals.rows,evidenceCounts:{timeline:events.rowCount||0,diagnoses:diagnoses.rowCount||0,notes:notes.rowCount||0,orders:orders.rowCount||0,laboratory:labs.rowCount||0,imaging:imaging.rowCount||0,medications:meds.rowCount||0,referrals:referrals.rowCount||0,careGaps:gaps.rowCount||0,clinicalSignals:signals.rowCount||0}}};
      }
      if(workspace==='clinical-velocity'){
        const safeQuery=async(label:string,sql:string,params:any[])=>{
          try{return {rows:(await pool!.query(sql,params)).rows,error:null}}
          catch(error){req.log.error({error,query:label},`Clinical Velocity section failed: ${label}`);return {rows:[],error:label}}
        };
        const [series,bottlenecks]=await Promise.all([
          safeQuery('activity trend',`WITH d AS (SELECT generate_series(current_date-($2::int-1),current_date,interval '1 day')::date AS day_date) SELECT d.day_date,COALESCE((SELECT count(*) FROM clinical_workflow_events e WHERE e.organization_id=$1 AND e.created_at::date=d.day_date),0)::int AS signals,COALESCE((SELECT count(*) FROM clinical_workflow_events e WHERE e.organization_id=$1 AND e.event_type IN ('result.verified','result.released','task.completed','referral.completed','followup.completed') AND e.created_at::date=d.day_date),0)::int AS actions,COALESCE((SELECT count(*) FROM encounters e WHERE e.organization_id=$1 AND e.started_at::date=d.day_date),0)::int AS encounters FROM d ORDER BY d.day_date`,[organizationId,days]),
          safeQuery('workflow bottlenecks',`WITH signals AS (SELECT id,event_type,patient_id,created_at FROM clinical_workflow_events WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval),actions AS (SELECT s.id,MIN(a.created_at) action_at,s.event_type FROM signals s LEFT JOIN clinical_workflow_events a ON a.organization_id=$1 AND a.patient_id=s.patient_id AND a.created_at>s.created_at AND a.event_type IN ('result.verified','result.released','task.completed','referral.completed','followup.completed') GROUP BY s.id,s.event_type,s.created_at) SELECT event_type AS "eventType",count(*)::int AS total,count(*) FILTER(WHERE action_at IS NULL)::int AS unresolved,round(avg(extract(epoch FROM(action_at-(SELECT created_at FROM signals s2 WHERE s2.id=actions.id)))/60.0) FILTER(WHERE action_at IS NOT NULL)::numeric,1) AS "averageMinutes" FROM actions GROUP BY event_type ORDER BY "averageMinutes" DESC NULLS LAST LIMIT 12`,[organizationId,String(days)])
        ]);
        const measures=[['Door to provider',`SELECT avg(extract(epoch FROM(e.started_at-a.start_at))/60.0) FROM encounters e JOIN appointments a ON a.id=e.appointment_id WHERE e.organization_id=$1 AND e.started_at>=now()-($2::text||' days')::interval AND e.started_at>=a.start_at`],['Lab turnaround',`SELECT avg(extract(epoch FROM(lr.verified_at-ls.collected_at))/60.0) FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_results lr ON lr.sample_id=ls.id WHERE EXISTS(SELECT 1 FROM patients p WHERE p.id=co.patient_id AND p.organization_id=$1) AND lr.verified_at IS NOT NULL AND ls.collected_at IS NOT NULL AND ls.collected_at>=now()-($2::text||' days')::interval`],['Imaging turnaround',`SELECT avg(extract(epoch FROM(isu.report_verified_at-isu.scheduled_at))/60.0) FROM imaging_studies isu WHERE isu.organization_id=$1 AND isu.report_verified_at IS NOT NULL AND isu.scheduled_at IS NOT NULL AND isu.scheduled_at>=now()-($2::text||' days')::interval`],['Referral turnaround',`SELECT avg(extract(epoch FROM(r.completed_at-r.requested_at))/60.0) FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.completed_at IS NOT NULL AND r.requested_at IS NOT NULL AND r.requested_at>=now()-($2::text||' days')::interval`],['Medication turnaround',`SELECT avg(extract(epoch FROM(d.dispensed_at-mo.prescribed_at))/60.0) FROM dispensations d JOIN medication_orders mo ON mo.id=d.medication_order_id JOIN patients p ON p.id=mo.patient_id WHERE p.organization_id=$1 AND d.dispensed_at IS NOT NULL AND mo.prescribed_at IS NOT NULL AND mo.prescribed_at>=now()-($2::text||' days')::interval`],['Discharge turnaround',`SELECT avg(extract(epoch FROM(a.discharged_at-a.admitted_at))/60.0) FROM admissions a WHERE a.organization_id=$1 AND a.discharged_at IS NOT NULL AND a.admitted_at IS NOT NULL AND a.admitted_at>=now()-($2::text||' days')::interval`]].map(async([label,sql])=>{const r=await safeQuery(String(label),String(sql),[organizationId,String(days)]);return {label,minutes:r.rows[0]?.avg==null?null:Number(Number(r.rows[0].avg).toFixed(1)),error:r.error}});
        const [turnaround]=await Promise.all([Promise.all(measures)]);
        return {data:{workspace,periodDays:days,trend:series.rows,bottlenecks:bottlenecks.rows,turnaround,widgetErrors:[series,bottlenecks,...turnaround].filter(x=>x.error).map(x=>x.error),source:'authoritative operational timestamps',note:'Measures are shown only where source timestamps exist.'}};
      }
      if(workspace==='value-based-care'){
        const [measures,utilization,gaps,followup]=await Promise.all([
          pool.query(`SELECT measure_code AS "measureCode",period_start AS "periodStart",period_end AS "periodEnd",numerator,denominator,value_numeric AS "valueNumeric",evidence FROM clinical_measure_results WHERE organization_id=$1 ORDER BY period_end DESC LIMIT 50`,[organizationId]),
          pool.query(`SELECT date_trunc('day',e.started_at)::date AS day,count(*)::int AS encounters,count(*) FILTER(WHERE e.status='completed')::int AS completed FROM encounters e WHERE e.organization_id=$1 AND e.started_at>=current_date-29 GROUP BY 1 ORDER BY 1`,[organizationId]),
          pool.query(`SELECT gap_type AS "gapType",severity,status,count(*)::int AS count FROM care_gap_snapshots WHERE organization_id=$1 GROUP BY gap_type,severity,status ORDER BY count DESC`,[organizationId]),
          pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status IN ('completed','closed'))::int AS completed FROM module_records WHERE organization_id=$1 AND module='follow-up'`,[organizationId])
        ]);
        return {data:{workspace,measures:measures.rows,utilization:utilization.rows,careGaps:gaps.rows,followUp:followup.rows[0],outcomeRule:'Only recorded operational measures are shown; operational completion is not presented as a clinical outcome without clinical validation.'}};
      }
      if(workspace==='ai-risk'){
        const [matrix,signals,assessments,incidents]=await Promise.all([
          pool.query(`SELECT risk_level AS "riskLevel",risk_type AS "riskType",status,count(*)::int AS count FROM ai_risk_assessments WHERE organization_id=$1 GROUP BY risk_level,risk_type,status ORDER BY count DESC`,[organizationId]),
          pool.query(`SELECT severity,status,count(*)::int AS count FROM clinical_signals WHERE organization_id=$1 GROUP BY severity,status ORDER BY count DESC`,[organizationId]),
          pool.query(`SELECT id,capability_id AS "capabilityId",risk_level AS "riskLevel",risk_type AS "riskType",status,source,findings,mitigations,reviewed_at AS "reviewedAt",created_at AS "createdAt" FROM ai_risk_assessments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`,[organizationId]),
          pool.query(`SELECT id,capability_id AS "capabilityId",severity,status,incident_type AS "incidentType",description,created_at AS "createdAt",resolved_at AS "resolvedAt" FROM ai_incidents WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50`,[organizationId])
        ]);
        return {data:{workspace,riskMatrix:matrix.rows,clinicalSignals:signals.rows,assessments:assessments.rows,incidents:incidents.rows,workflow:['risk-classification','evaluation','clinical-validation','approval','monitoring','incident','mitigation','residual-risk','review','retirement'],humanReviewRequired:true}};
      }
      if(workspace==='ai-security'){
        const [trend,events,controls]=await Promise.all([
          pool.query(`SELECT created_at::date AS day,severity,count(*)::int AS count FROM ai_security_events WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval GROUP BY created_at::date,severity ORDER BY day`,[organizationId,String(days)]),
          pool.query(`SELECT event_type AS "eventType",severity,status,source,count(*)::int AS count,max(created_at) AS "lastSeen" FROM ai_security_events WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval GROUP BY event_type,severity,status,source ORDER BY count DESC`,[organizationId,String(days)]),
          pool.query(`SELECT event_type AS "eventType",count(*)::int AS count FROM ai_security_events WHERE organization_id=$1 GROUP BY event_type ORDER BY count DESC`,[organizationId])
        ]);
        const catalog=['prompt-injection','indirect-injection','data-disclosure','cross-tenant-access','role-spoofing','unauthorized-patient-lookup','tool-misuse','provider-leakage','unsafe-output','abuse-rate-limit']; const seen=new Set(controls.rows.map((r:any)=>String(r.eventType)));
        return {data:{workspace,periodDays:days,trend:trend.rows,events:events.rows,controls:catalog.map(control=>({control,observed:seen.has(control),status:seen.has(control)?'observed':'no-events-recorded'})),policy:{tenantIsolation:true,serverDerivedRole:true,patientAuthorization:true,providerLeakageBlocked:true,unsafeOutputBlocked:true,rateLimitsEnforced:true}}};
      }
      if(workspace==='ai-governance'){
        const [caps,evals,feedback,usage,incidents,lifecycle]=await Promise.all([
          pool.query(`SELECT capability_id AS "capabilityId",name,domain,risk_level AS "riskLevel",status,version FROM ai_capabilities WHERE organization_id=$1 OR organization_id IS NULL ORDER BY domain,capability_id`,[organizationId]),
          pool.query(`SELECT evaluation_type AS "evaluationType",status,count(*)::int AS count FROM ai_capability_evaluations WHERE organization_id=$1 GROUP BY evaluation_type,status ORDER BY count DESC`,[organizationId]),
          pool.query(`SELECT rating,count(*)::int AS count FROM ai_feedback WHERE organization_id=$1 GROUP BY rating ORDER BY count DESC`,[organizationId]),
          pool.query(`SELECT event_type AS "eventType",count(*)::int AS count FROM ai_usage_events WHERE organization_id=$1 GROUP BY event_type ORDER BY count DESC LIMIT 20`,[organizationId]),
          pool.query(`SELECT severity,status,incident_type AS "incidentType",count(*)::int AS count FROM ai_incidents WHERE organization_id=$1 GROUP BY severity,status,incident_type ORDER BY count DESC`,[organizationId]),
          pool.query(`SELECT model_id AS "modelId",event_type AS "eventType",environment,outcome,count(*)::int AS count FROM ai_model_lifecycle_events WHERE organization_id=$1 GROUP BY model_id,event_type,environment,outcome ORDER BY count DESC`,[organizationId])
        ]);
        return {data:{workspace,capabilities:caps.rows,evaluations:evals.rows,feedback:feedback.rows,usage:usage.rows,incidents:incidents.rows,lifecycle:lifecycle.rows,humanReview:true}};
      }
      if(workspace==='ai-evaluations'){
        const [summary,trend,recent]=await Promise.all([
          pool.query(`SELECT verdict,count(*)::int AS count FROM ai_evaluations WHERE organization_id=$1 GROUP BY verdict ORDER BY count DESC`,[organizationId]),
          pool.query(`SELECT created_at::date AS day,count(*)::int AS count,count(*) FILTER(WHERE verdict='pass')::int AS passed,count(*) FILTER(WHERE verdict='fail')::int AS failed FROM ai_evaluations WHERE organization_id=$1 AND created_at>=now()-interval '90 days' GROUP BY created_at::date ORDER BY day`,[organizationId]),
          pool.query(`SELECT id,model_version AS "modelVersion",use_case AS "useCase",verdict,safety_flags AS "safetyFlags",reviewed_at AS "reviewedAt",created_at AS "createdAt" FROM ai_evaluations WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`,[organizationId])
        ]);
        return {data:{workspace,summary:summary.rows,trend:trend.rows,recent:recent.rows,qualityDimensions:['response quality','grounding','safety','latency','clinician feedback','accepted/rejected suggestions'],humanReviewRequired:true}};
      }
      if(workspace==='care-gaps'){
        const [summary,trend,recent]=await Promise.all([
          pool.query(`SELECT gap_type AS "gapType",severity,status,count(*)::int AS count FROM care_gap_snapshots WHERE organization_id=$1 GROUP BY gap_type,severity,status ORDER BY count DESC`,[organizationId]),
          pool.query(`SELECT detected_at::date AS day,count(*)::int AS detected,count(*) FILTER(WHERE status='resolved')::int AS closed FROM care_gap_snapshots WHERE organization_id=$1 AND detected_at>=now()-interval '90 days' GROUP BY detected_at::date ORDER BY day`,[organizationId]),
          pool.query(`SELECT cg.id,cg.patient_id AS "patientId",p.patient_number AS "patientNumber",cg.gap_type AS "gapType",cg.severity,cg.status,cg.source_module AS "sourceModule",cg.evidence,cg.detected_at AS "detectedAt" FROM care_gap_snapshots cg JOIN patients p ON p.id=cg.patient_id WHERE cg.organization_id=$1 ORDER BY CASE cg.severity WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,cg.detected_at DESC LIMIT 150`,[organizationId])
        ]);
        return {data:{workspace,summary:summary.rows,trend:trend.rows,recent:recent.rows,workflow:['detected','review','assigned','in-progress','resolved'],humanReviewRequired:true}};
      }
      const [districts,indicators,facilities,pressure]=await Promise.all([
        pool.query(`SELECT id,name,code,region,status FROM districts WHERE organization_id=$1 ORDER BY name`,[organizationId]),
        pool.query(`SELECT indicator_code AS "indicatorCode",indicator_name AS "indicatorName",period_start AS "periodStart",period_end AS "periodEnd",numerator,denominator,value,dimensions,source,status FROM population_indicators WHERE organization_id=$1 ORDER BY period_end DESC LIMIT 150`,[organizationId]),
        pool.query(`SELECT f.id,f.name,f.type,d.id AS "districtId",d.name AS "districtName" FROM facilities f LEFT JOIN district_facility_links l ON l.facility_id=f.id AND l.organization_id=f.organization_id LEFT JOIN districts d ON d.id=l.district_id WHERE f.organization_id=$1 ORDER BY d.name NULLS LAST,f.name`,[organizationId]),
        pool.query(`SELECT f.id,f.name,COALESCE((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='occupied'),0)::int AS occupied,COALESCE((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='available'),0)::int AS available,COALESCE((SELECT count(*) FROM facility_operational_incidents i WHERE i.facility_id=f.id AND i.status NOT IN ('resolved','closed')),0)::int AS incidents,COALESCE((SELECT count(*) FROM encounters e WHERE e.facility_id=f.id AND e.status IN ('in-progress','active')),0)::int AS active_encounters FROM facilities f WHERE f.organization_id=$1 ORDER BY active_encounters DESC`,[organizationId])
      ]);
      return {data:{workspace:'district-intelligence',districts:districts.rows,indicators:indicators.rows,facilities:facilities.rows,facilityPressure:pressure.rows,note:'District intelligence is limited to recorded district links, population indicators and facility operational data.'}};
    }catch(e:any){req.log.error(e);return reply.code(500).send({error:'The intelligence workspace could not be prepared.'});}
  });

  app.post('/api/phase10/intelligence/:workspace/action', async(req:any,reply:any)=>{
    if(!pool)return reply.code(503).send({error:'Intelligence actions are temporarily unavailable.'});
    try{deps.requireAuthorizedWrite(req);}catch(e:any){return reply.code(e.statusCode||403).send({error:e.message||'Permission required.'});}
    const workspace=String(req.params.workspace||'').toLowerCase();
    const b=z.object({id:z.string().uuid(),action:z.string().min(2),reason:z.string().max(1000).optional()}).parse(req.body||{});
    if(!ACTIONS.has(b.action))return reply.code(400).send({error:'Unsupported intelligence action.'});
    const organizationId=org(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required.'});
    try{
      if(workspace==='ai-evaluations'){
        const verdict=b.action==='review'?'needs-review':b.action==='resolve'?'pass':b.action==='dismiss'?'fail':undefined;
        if(!verdict)return reply.code(400).send({error:'Evaluation actions support review, resolve or dismiss.'});
        const r=await pool.query(`UPDATE ai_evaluations SET verdict=$1,reviewer_id=$2,reviewed_at=now() WHERE id=$3 AND organization_id=$4 RETURNING id,verdict,reviewed_at AS "reviewedAt"`,[verdict,deps.dbUserId(req),b.id,organizationId]);
        if(!r.rowCount)return reply.code(404).send({error:'Evaluation not found.'}); await deps.dbAudit('ai-evaluation-action','ai_evaluations',b.id,{action:b.action,reason:b.reason||null}); return {data:r.rows[0]};
      }
      if(workspace==='care-gaps'){
        const status=b.action==='resolve'?'resolved':b.action==='dismiss'?'dismissed':b.action==='acknowledge'?'acknowledged':b.action==='review'?'in-review':'escalated';
        const r=await pool.query(`UPDATE care_gap_snapshots SET status=$1,closed_at=CASE WHEN $1 IN ('resolved','dismissed') THEN now() ELSE closed_at END WHERE id=$2 AND organization_id=$3 RETURNING id,status,closed_at AS "closedAt"`,[status,b.id,organizationId]);
        if(!r.rowCount)return reply.code(404).send({error:'Care gap not found.'}); await deps.dbAudit('care-gap-action','care_gap_snapshots',b.id,{action:b.action,reason:b.reason||null}); return {data:r.rows[0]};
      }
      if(['ai-risk','ai-security','ai-governance'].includes(workspace)){
        if(workspace==='ai-risk'){
          const r=await pool.query(`UPDATE ai_risk_assessments SET status=$1,reviewed_at=CASE WHEN $1 IN ('reviewed','approved','resolved') THEN now() ELSE reviewed_at END WHERE id=$2 AND organization_id=$3 RETURNING id,status,reviewed_at AS "reviewedAt"`,[b.action==='dismiss'?'dismissed':b.action==='resolve'?'resolved':b.action==='review'?'reviewed':'escalated',b.id,organizationId]); if(!r.rowCount)return reply.code(404).send({error:'Risk assessment not found.'}); return {data:r.rows[0]};
        }
        if(workspace==='ai-security'){
          const r=await pool.query(`UPDATE ai_security_events SET status=$1 WHERE id=$2 AND organization_id=$3 RETURNING id,status`,[b.action==='resolve'?'resolved':b.action==='dismiss'?'dismissed':b.action==='review'?'reviewed':'escalated',b.id,organizationId]); if(!r.rowCount)return reply.code(404).send({error:'Security event not found.'}); return {data:r.rows[0]};
        }
        return reply.code(400).send({error:'Governance actions must use capability evaluation or incident workflows.'});
      }
      const r=await pool.query(`UPDATE clinical_signals SET status=$1,acknowledged_by=CASE WHEN $1 IN ('acknowledged','reviewed') THEN $2 ELSE acknowledged_by END,acknowledged_at=CASE WHEN $1 IN ('acknowledged','reviewed') THEN now() ELSE acknowledged_at END,resolved_by=CASE WHEN $1 IN ('resolved','dismissed') THEN $2 ELSE resolved_by END,resolved_at=CASE WHEN $1 IN ('resolved','dismissed') THEN now() ELSE resolved_at END,updated_at=now() WHERE id=$3 AND organization_id=$4 RETURNING id,status,acknowledged_at AS "acknowledgedAt",resolved_at AS "resolvedAt"`,[b.action==='resolve'?'resolved':b.action==='dismiss'?'dismissed':'acknowledged',deps.dbUserId(req),b.id,organizationId]);
      if(!r.rowCount)return reply.code(404).send({error:'Clinical signal not found.'});
      await pool.query(`INSERT INTO clinical_signal_actions(signal_id,organization_id,actor_user_id,action,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)`,[b.id,organizationId,deps.dbUserId(req),b.action,b.reason||null,JSON.stringify({source:'phase10'})]);
      await deps.dbAudit('clinical-signal-action','clinical_signals',b.id,{action:b.action,reason:b.reason||null}); return {data:r.rows[0]};
    }catch(e:any){req.log.error(e);return reply.code(500).send({error:'The intelligence action could not be completed.'});}
  });

  app.get('/api/phase11/home',async(req:any,reply:any)=>{
    if(!pool)return reply.code(503).send({error:'Clinical Command Center is temporarily unavailable.'});
    const organizationId=org(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required.'});
    const safeQuery=async(label:string,sql:string,params:any[])=>{
      try{return {rows:(await pool!.query(sql,params)).rows,error:null}}
      catch(error){req.log.error({error,query:label},`Command Center section failed: ${label}`);return {rows:[],error:label}}
    };
    try{
      const [summary,flow,activity,safety,frontline,operations,finance,facility,services]=await Promise.all([
        safeQuery('summary',`SELECT
          (SELECT count(*) FROM encounters WHERE organization_id=$1 AND status IN ('in-progress','active'))::int AS "activePatients",
          (SELECT count(*) FROM encounters WHERE organization_id=$1 AND started_at::date=current_date)::int AS "todaysEncounters",
          (SELECT count(*) FROM emergency_cases WHERE organization_id=$1 AND status NOT IN ('discharged','completed','cancelled'))::int AS "emergencyCases",
          (SELECT count(*) FROM clinical_signals WHERE organization_id=$1 AND severity IN ('critical','high') AND status NOT IN ('resolved','closed','dismissed'))::int AS "criticalAlerts",
          (SELECT count(*) FROM clinical_orders WHERE patient_id IN (SELECT id FROM patients WHERE organization_id=$1) AND status IN ('pending','ordered','in-progress'))::int AS "pendingInvestigations",
          (SELECT count(*) FROM medication_orders mo JOIN patients p ON p.id=mo.patient_id WHERE p.organization_id=$1 AND mo.status IN ('active','pending','ordered'))::int AS "pendingMedicationActions",
          (SELECT count(*) FROM admissions WHERE organization_id=$1 AND status IN ('admitted','inpatient','active'))::int AS admissions,
          (SELECT count(*) FROM admissions WHERE organization_id=$1 AND discharged_at::date=current_date)::int AS discharges,
          (SELECT count(*) FROM care_tasks WHERE organization_id=$1 AND status NOT IN ('completed','closed','cancelled') AND due_at IS NOT NULL AND due_at<now())::int AS "overdueTasks",
          (SELECT count(*) FROM care_gap_snapshots WHERE organization_id=$1 AND status NOT IN ('resolved','closed','dismissed'))::int AS "careGaps"`,[organizationId]),
        safeQuery('operational flow',`SELECT stage,count_value::int AS count FROM (VALUES ('Registration',(SELECT count(*) FROM patients WHERE organization_id=$1 AND created_at::date=current_date)),('Triage',(SELECT count(*) FROM triage_assessments WHERE organization_id=$1 AND created_at::date=current_date)),('Consultation',(SELECT count(*) FROM encounters WHERE organization_id=$1 AND started_at::date=current_date)),('Orders',(SELECT count(*) FROM clinical_orders WHERE patient_id IN (SELECT id FROM patients WHERE organization_id=$1) AND created_at::date=current_date)),('Laboratory',(SELECT count(*) FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 AND ls.created_at::date=current_date)),('Imaging',(SELECT count(*) FROM imaging_studies WHERE organization_id=$1 AND created_at::date=current_date)),('Treatment',(SELECT count(*) FROM medication_orders mo JOIN patients p ON p.id=mo.patient_id WHERE p.organization_id=$1 AND mo.prescribed_at::date=current_date)),('Pharmacy',(SELECT count(*) FROM dispensations d JOIN medication_orders mo ON mo.id=d.medication_order_id JOIN patients p ON p.id=mo.patient_id WHERE p.organization_id=$1 AND d.dispensed_at::date=current_date)),('Admission',(SELECT count(*) FROM admissions WHERE organization_id=$1 AND admitted_at::date=current_date)),('Discharge',(SELECT count(*) FROM admissions WHERE organization_id=$1 AND discharged_at::date=current_date))) v(stage,count_value)`,[organizationId]),
        safeQuery('clinical activity',`WITH d AS (SELECT generate_series(current_date-6,current_date,interval '1 day')::date AS day_date) SELECT d.day_date,(SELECT count(*) FROM patients WHERE organization_id=$1 AND created_at::date=d.day_date)::int AS registrations,(SELECT count(*) FROM encounters WHERE organization_id=$1 AND started_at::date=d.day_date)::int AS encounters,(SELECT count(*) FROM admissions WHERE organization_id=$1 AND admitted_at::date=d.day_date)::int AS admissions,(SELECT count(*) FROM admissions WHERE organization_id=$1 AND discharged_at::date=d.day_date)::int AS discharges,(SELECT count(*) FROM emergency_cases WHERE organization_id=$1 AND arrival_at::date=d.day_date)::int AS emergency FROM d ORDER BY d.day_date`,[organizationId]),
        safeQuery('patient safety',`SELECT 'Critical results' AS type,count(*)::int AS count FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 AND lr.critical=true AND lr.status NOT IN ('released','closed') UNION ALL SELECT 'Abnormal observations',count(*)::int FROM observations o JOIN patients p ON p.id=o.patient_id WHERE p.organization_id=$1 AND (COALESCE(o.value_text,'') ILIKE '%abnormal%' OR COALESCE(o.display,'') ILIKE '%abnormal%') UNION ALL SELECT 'Deterioration signals',count(*)::int FROM clinical_signals WHERE organization_id=$1 AND severity IN ('critical','high') AND status NOT IN ('resolved','closed','dismissed') UNION ALL SELECT 'Medication safety signals',count(*)::int FROM clinical_signals WHERE organization_id=$1 AND signal_type ILIKE '%med%' AND status NOT IN ('resolved','closed','dismissed') UNION ALL SELECT 'Overdue follow-up',count(*)::int FROM module_records WHERE organization_id=$1 AND module='follow-up' AND status NOT IN ('completed','closed','cancelled') AND (payload->>'dueAt') IS NOT NULL AND (payload->>'dueAt')::timestamptz<now() UNION ALL SELECT 'Care gaps',count(*)::int FROM care_gap_snapshots WHERE organization_id=$1 AND status NOT IN ('resolved','closed','dismissed')`,[organizationId]),
        safeQuery('AI frontline',`SELECT id,patient_id AS "patientId",severity,title,summary,evidence,recommendation,detected_at AS "detectedAt",status FROM clinical_signals WHERE organization_id=$1 AND status NOT IN ('resolved','closed','dismissed') ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,detected_at DESC LIMIT 30`,[organizationId]),
        safeQuery('operational attention',`SELECT 'Overdue tasks' AS type,count(*)::int AS count FROM care_tasks WHERE organization_id=$1 AND status NOT IN ('completed','closed','cancelled') AND due_at<now() UNION ALL SELECT 'Delayed referrals',count(*)::int FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.status NOT IN ('completed','closed','cancelled') AND COALESCE(r.requested_at,r.created_at)<now()-interval '7 days' UNION ALL SELECT 'Open facility incidents',count(*)::int FROM facility_operational_incidents WHERE organization_id=$1 AND status NOT IN ('resolved','closed') UNION ALL SELECT 'Beds under pressure',count(*)::int FROM facility_beds WHERE organization_id=$1 AND status IN ('occupied','blocked')`,[organizationId]),
        safeQuery('financial context',`SELECT COALESCE(sum(i.total),0)::numeric AS billed,COALESCE(sum(CASE WHEN i.status='paid' THEN i.total ELSE 0 END),0)::numeric AS paid,COALESCE(sum(CASE WHEN i.status<>'paid' THEN i.total ELSE 0 END),0)::numeric AS outstanding,count(*)::int AS invoices FROM invoices i WHERE i.organization_id=$1`,[organizationId]),
        safeQuery('facility readiness',`SELECT f.id,f.name,f.type,COALESCE((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='occupied'),0)::int AS occupied,COALESCE((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='available'),0)::int AS available,COALESCE((SELECT count(*) FROM facility_operational_incidents i WHERE i.facility_id=f.id AND i.status NOT IN ('resolved','closed')),0)::int AS incidents FROM facilities f WHERE f.organization_id=$1 ORDER BY f.name`,[organizationId]),
        safeQuery('encounters by service',`SELECT COALESCE(e.type,'unknown') AS service,count(*)::int AS count FROM encounters e WHERE e.organization_id=$1 AND e.started_at>=current_date-29 GROUP BY e.type ORDER BY count DESC LIMIT 12`,[organizationId])
      ]);
      return {data:{generatedAt:new Date().toISOString(),summary:summary.rows[0]||{},operationalFlow:flow.rows,clinicalActivity:activity.rows,patientSafety:safety.rows,aiFrontline:frontline.rows,operationalAttention:operations.rows,finance:finance.rows[0]||{},facilities:facility.rows,encountersByService:services.rows,humanReview:{requiredForClinicalSignals:true},widgetErrors:[summary,flow,activity,safety,frontline,operations,finance,facility,services].filter(x=>x.error).map(x=>x.error),source:'authoritative operational and clinical records'}};
    }catch(e:any){req.log.error(e);return reply.code(500).send({error:'The Clinical Command Center could not be prepared.'});}
  });
}
