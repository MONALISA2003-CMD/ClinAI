import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

type Row = Record<string, any>;
type Ctx = {
  dbOrganizationId: (req: any) => string | null;
  dbUserId: (req: any) => string | null;
  requireAuthorizedWrite: (req: any) => void;
  dbAudit: (client: any, req: any, action: string, entityType: string, entityId: string, metadata?: Row) => Promise<void>;
  queueEvent: (client: any, req: any, type: string, payload: Row) => Promise<void>;
};

type ModuleConfig = {
  table: string;
  select: string;
  alias: string;
  dateColumn: string;
  statusColumn?: string;
  breakdownColumn?: string;
  patientJoin: string | null;
  organizationPredicate?: string;
  trendJoin?: string;
  publicFilter?: string;
  facilityJoin?: string;
  searchColumns: string[];
  orderBy: string;
};

function replaceQualifiedAlias(sql:string, alias:string, replacement:string){
  const escaped=alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return sql.replace(new RegExp(`\\b${escaped}\\.`,'g'), `${replacement}.`);
}

const MODULES: Record<string, ModuleConfig> = {
  emergency: {
    table: 'emergency_cases', alias: 'e', dateColumn: 'e.arrival_at', statusColumn: 'e.status', breakdownColumn: 'e.acuity', patientJoin: 'JOIN patients p ON p.id=e.patient_id',
    select: `e.id,e.patient_id AS "patientId",e.encounter_id AS "encounterId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",e.acuity,e.triage_level AS "triageLevel",e.status,e.chief_complaint AS "chiefComplaint",e.arrival_at AS "arrivalAt",e.disposition,e.disposition_at AS "dispositionAt",e.notes,e.created_at AS "createdAt",e.updated_at AS "updatedAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','e.chief_complaint','e.acuity'], orderBy: 'e.arrival_at DESC'
  },
  inpatient: {
    table: 'admissions', alias: 'a', dateColumn: 'a.admitted_at', statusColumn: 'a.status', breakdownColumn: 'a.ward', patientJoin: 'JOIN patients p ON p.id=a.patient_id',
    select: `a.id,a.patient_id AS "patientId",a.encounter_id AS "encounterId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",a.ward,a.bed,a.status,a.admitted_at AS "admittedAt",a.discharged_at AS "dischargedAt",a.discharge_summary AS "dischargeSummary",a.created_at AS "createdAt",a.updated_at AS "updatedAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','a.ward','a.bed','a.status'], orderBy: 'a.admitted_at DESC'
  },
  beds: {
    table: 'facility_beds', alias: 'b', dateColumn: 'b.observed_at', statusColumn: 'b.status', breakdownColumn: 'b.ward', patientJoin: 'LEFT JOIN patients p ON p.id=b.patient_id', publicFilter: "EXISTS (SELECT 1 FROM patients pubp WHERE pubp.id=b.patient_id AND pubp.patient_number LIKE 'TEST-%')", facilityJoin: 'JOIN facilities f ON f.id=b.facility_id',
    select: `b.id,b.facility_id AS "facilityId",f.name AS "facilityName",b.ward,b.room,b.bed_number AS "bedNumber",b.bed_type AS "bedType",b.status,b.patient_id AS "patientId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",b.admission_id AS "admissionId",b.observed_at AS "observedAt",b.metadata`,
    searchColumns: ['f.name','b.ward','b.room','b.bed_number','p.patient_number'], orderBy: 'b.observed_at DESC'
  },
  nursing: {
    table: 'nursing_assessments', alias: 'n', dateColumn: 'n.created_at', statusColumn: 'n.status', breakdownColumn: 'n.assessment_type', patientJoin: 'JOIN patients p ON p.id=n.patient_id',
    select: `n.id,n.patient_id AS "patientId",n.encounter_id AS "encounterId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",n.nurse_user_id AS "nurseUserId",n.assessment_type AS "assessmentType",n.findings,n.pain_score AS "painScore",n.risk_flags AS "riskFlags",n.status,n.created_at AS "createdAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','n.assessment_type','n.status'], orderBy: 'n.created_at DESC'
  },
  surgery: {
    table: 'surgery_cases', alias: 's', dateColumn: 'COALESCE(s.scheduled_at,s.created_at)', statusColumn: 's.status', breakdownColumn: 's.status', patientJoin: 'JOIN patients p ON p.id=s.patient_id',
    select: `s.id,s.patient_id AS "patientId",s.encounter_id AS "encounterId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",s.procedure_name AS "procedureName",s.scheduled_at AS "scheduledAt",s.status,s.consent_confirmed AS "consentConfirmed",s.surgeon_user_id AS "surgeonUserId",s.anaesthesia_plan AS "anaesthesiaPlan",s.checklist,s.notes,s.created_at AS "createdAt",s.updated_at AS "updatedAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','s.procedure_name','s.status'], orderBy: 'COALESCE(s.scheduled_at,s.created_at) DESC'
  },
  maternity: {
    table: 'maternity_records', alias: 'm', dateColumn: 'm.event_at', statusColumn: 'm.status', breakdownColumn: 'm.event_type', patientJoin: 'JOIN patients p ON p.id=m.patient_id',
    select: `m.id,m.patient_id AS "patientId",m.encounter_id AS "encounterId",m.pregnancy_id AS "pregnancyId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",m.event_type AS "eventType",m.gestational_age_weeks AS "gestationalAgeWeeks",m.gravida,m.para,m.maternal_observations AS "maternalObservations",m.fetal_observations AS "fetalObservations",m.status,m.event_at AS "eventAt",m.notes,m.created_at AS "createdAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','m.event_type','m.status'], orderBy: 'm.event_at DESC'
  },
  pediatrics: {
    table: 'pediatric_assessments', alias: 'a', dateColumn: 'a.created_at', breakdownColumn: 'a.nutrition_status', patientJoin: 'JOIN patients p ON p.id=a.patient_id',
    select: `a.id,a.patient_id AS "patientId",a.encounter_id AS "encounterId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",a.age_months AS "ageMonths",a.weight_kg AS "weightKg",a.height_cm AS "heightCm",a.muac_mm AS "muacMm",a.temperature,a.respiratory_rate AS "respiratoryRate",a.spo2,a.assessment,a.imci_classification AS "imciClassification",a.nutrition_status AS "nutritionStatus",a.referral_required AS "referralRequired",a.created_at AS "createdAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','a.nutrition_status'], orderBy: 'a.created_at DESC'
  },
  'child-health': {
    table: 'child_health_visits', alias: 'c', dateColumn: 'c.visit_date', breakdownColumn: "CASE WHEN COALESCE(c.referral_required,false) THEN 'referral-required' ELSE 'routine' END", patientJoin: 'JOIN patients p ON p.id=c.patient_id',
    select: `c.id,c.patient_id AS "patientId",c.encounter_id AS "encounterId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",c.visit_date AS "visitDate",c.age_days AS "ageDays",c.age_months AS "ageMonths",c.weight_kg AS "weightKg",c.length_height_cm AS "lengthHeightCm",c.head_circumference_cm AS "headCircumferenceCm",c.muac_mm AS "muacMm",c.temperature_c AS "temperatureC",c.respiratory_rate AS "respiratoryRate",c.spo2,c.feeding_assessment AS "feedingAssessment",c.developmental_assessment AS "developmentalAssessment",c.danger_signs AS "dangerSigns",c.clinical_assessment AS "clinicalAssessment",c.plan,c.referral_required AS "referralRequired",c.source_guideline AS "sourceGuideline",c.created_at AS "createdAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','c.source_guideline'], orderBy: 'c.visit_date DESC'
  },
  immunization: {
    table: 'immunizations', alias: 'i', dateColumn: 'i.administered_at', statusColumn: 'i.status', breakdownColumn: 'i.vaccine_name', patientJoin: 'JOIN patients p ON p.id=i.patient_id',
    select: `i.id,i.patient_id AS "patientId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",i.vaccine_code AS "vaccineCode",i.vaccine_name AS "vaccineName",i.dose_number AS "doseNumber",i.administered_at AS "administeredAt",i.lot_number AS "lotNumber",i.expiry_date AS "expiryDate",i.route,i.site,i.vaccinator_user_id AS "vaccinatorUserId",i.status,i.next_due_at AS "nextDueAt",i.notes,i.created_at AS "createdAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','i.vaccine_code','i.vaccine_name','i.status'], orderBy: 'i.administered_at DESC'
  },
  'chronic-care': {
    table: 'chronic_care_records', alias: 'c', dateColumn: 'c.created_at', statusColumn: 'c.status', breakdownColumn: 'c.risk_level', patientJoin: 'JOIN patients p ON p.id=c.patient_id',
    select: `c.id,c.patient_id AS "patientId",c.encounter_id AS "encounterId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",c.condition_code AS "conditionCode",c.condition_name AS "conditionName",c.status,c.goals,c.measures,c.medications,c.next_review_at AS "nextReviewAt",c.risk_level AS "riskLevel",c.care_plan AS "carePlan",c.created_at AS "createdAt",c.updated_at AS "updatedAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','c.condition_code','c.condition_name','c.status'], orderBy: 'c.updated_at DESC'
  },
  consents: {
    table: 'patient_consents', alias: 'c', dateColumn: 'c.granted_at', statusColumn: 'c.status', breakdownColumn: 'c.consent_type', patientJoin: 'JOIN patients p ON p.id=c.patient_id',
    select: `c.id,c.patient_id AS "patientId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",c.consent_type AS "consentType",c.version,c.status,c.scope,c.granted_at AS "grantedAt",c.expires_at AS "expiresAt",c.recorded_by AS "recordedBy"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','c.consent_type','c.status'], orderBy: 'c.granted_at DESC'
  },
  referrals: {
    table: 'referrals', alias: 'r', dateColumn: 'r.requested_at', statusColumn: 'r.status', breakdownColumn: 'r.urgency', patientJoin: 'JOIN patients p ON p.id=r.patient_id', organizationPredicate: '(SELECT organization_id FROM patients orgp WHERE orgp.id=r.patient_id)', publicFilter: "(SELECT patient_number FROM patients pubp WHERE pubp.id=r.patient_id) LIKE 'TEST-%'",
    select: `r.id,r.patient_id AS "patientId",r.encounter_id AS "encounterId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",r.destination,r.reason,r.referral_type AS "referralType",r.service_code AS "serviceCode",r.urgency,r.destination_facility_id AS "destinationFacilityId",r.referring_provider_id AS "referringProviderId",r.clinical_summary AS "clinicalSummary",r.status,r.requested_at AS "requestedAt",r.accepted_at AS "acceptedAt",r.completed_at AS "completedAt",r.updated_at AS "updatedAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','r.destination','r.reason','r.service_code','r.status'], orderBy: 'r.requested_at DESC'
  },
  'referral-network': {
    table: 'referral_network_nodes', alias: 'n', dateColumn: 'n.created_at', statusColumn: 'n.status', breakdownColumn: 'n.service_code', patientJoin: null, publicFilter: "n.metadata->>'synthetic' = 'true'",
    select: `n.id,n.from_facility_id AS "fromFacilityId",ff.name AS "fromFacilityName",n.to_facility_id AS "toFacilityId",tf.name AS "toFacilityName",n.service_code AS "serviceCode",n.status,n.typical_wait_minutes AS "typicalWaitMinutes",n.transport_notes AS "transportNotes",n.metadata,n.created_at AS "createdAt"`,
    facilityJoin: 'JOIN facilities ff ON ff.id=n.from_facility_id JOIN facilities tf ON tf.id=n.to_facility_id',
    searchColumns: ['ff.name','tf.name','n.service_code','n.status'], orderBy: 'n.created_at DESC'
  },
  'care-gaps': {
    table: 'care_gap_snapshots', alias: 'g', dateColumn: 'g.detected_at', statusColumn: 'g.status', breakdownColumn: 'g.severity', patientJoin: 'LEFT JOIN patients p ON p.id=g.patient_id',
    select: `g.id,g.patient_id AS "patientId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",g.gap_type AS "gapType",g.severity,g.status,g.source_module AS "sourceModule",g.evidence,g.detected_at AS "detectedAt",g.closed_at AS "closedAt",g.created_at AS "createdAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','g.gap_type','g.source_module','g.status'], orderBy: 'g.detected_at DESC'
  },
  'patient-portal': {
    table: 'patient_portal_accounts', alias: 'a', dateColumn: 'a.updated_at', statusColumn: 'a.status', breakdownColumn: 'a.status', patientJoin: 'JOIN patients p ON p.id=a.patient_id',
    select: `a.id,a.patient_id AS "patientId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",a.email,a.phone,a.status,a.last_login_at AS "lastLoginAt",a.notification_preferences AS "notificationPreferences",a.created_at AS "createdAt",a.updated_at AS "updatedAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','a.email','a.phone','a.status'], orderBy: 'a.updated_at DESC'
  },
  'portal-messages': {
    table: 'portal_messages', alias: 'm', dateColumn: 'm.created_at', statusColumn: 'm.status', breakdownColumn: 'm.direction', patientJoin: 'JOIN patients p ON p.id=m.patient_id',
    select: `m.id,m.patient_id AS "patientId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",m.direction,m.channel,m.subject,m.body,m.status,m.sent_by AS "sentBy",m.created_at AS "createdAt",m.read_at AS "readAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','m.subject','m.body','m.status'], orderBy: 'm.created_at DESC'
  },
  telemedicine: {
    table: 'telemedicine_sessions', alias: 't', dateColumn: 't.scheduled_at', statusColumn: 't.status', breakdownColumn: 't.status', patientJoin: 'JOIN patients p ON p.id=t.patient_id',
    select: `t.id,t.patient_id AS "patientId",t.appointment_id AS "appointmentId",t.encounter_id AS "encounterId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",t.scheduled_at AS "scheduledAt",t.status,t.meeting_url AS "meetingUrl",t.identity_verified AS "identityVerified",t.consent_confirmed AS "consentConfirmed",t.started_at AS "startedAt",t.ended_at AS "endedAt",t.provider_user_id AS "providerUserId",t.notes,t.created_at AS "createdAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','t.status','t.meeting_url'], orderBy: 't.scheduled_at DESC'
  },
  'remote-monitoring': {
    table: 'remote_monitoring_readings', alias: 'r', dateColumn: 'r.measured_at', statusColumn: 'r.alert_status', breakdownColumn: 'r.metric', patientJoin: 'JOIN patients p ON p.id=r.patient_id',
    select: `r.id,r.patient_id AS "patientId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",r.device_id AS "deviceId",r.metric,r.value_numeric AS "valueNumeric",r.unit,r.measured_at AS "measuredAt",r.source,r.validation_status AS "validationStatus",r.alert_status AS "alertStatus",r.metadata,r.created_at AS "createdAt"`,
    searchColumns: ['p.patient_number','p.first_name','p.last_name','r.metric','r.device_id','r.source','r.alert_status'], orderBy: 'r.measured_at DESC'
  }
};

function jsonValue(v:any, fallback:any) { if (v===undefined || v===null || v==='') return fallback; if (typeof v==='object') return v; try { return JSON.parse(String(v)); } catch { throw Object.assign(new Error('JSON fields must contain valid structured information.'),{statusCode:400}); } }
function num(v:any) { if (v===undefined || v===null || v==='') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function str(v:any) { return v===undefined || v===null ? null : String(v).trim() || null; }
function assertUuid(v:any,label:string){ try{z.string().uuid().parse(v);return String(v)}catch{throw Object.assign(new Error(`${label} must be a valid identifier.`),{statusCode:400});} }

async function patientBelongs(client:any, patientId:string, orgId:string){ const r=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2 LIMIT 1',[patientId,orgId]); return Boolean(r.rowCount); }
async function encounterBelongs(client:any, encounterId:string|undefined, patientId:string|undefined, orgId:string){ if(!encounterId)return true; const r=await client.query('SELECT patient_id FROM encounters WHERE id=$1 AND organization_id=$2 LIMIT 1',[encounterId,orgId]); return Boolean(r.rowCount) && (!patientId || r.rows[0].patient_id===patientId); }
async function facilityBelongs(client:any, facilityId:string, orgId:string){ const r=await client.query('SELECT id FROM facilities WHERE id=$1 AND organization_id=$2 LIMIT 1',[facilityId,orgId]); return Boolean(r.rowCount); }

// Route family: /api/phase45/:module and /api/phase45/:module/:id/action
export function registerPhase45AcuteContinuityRoutes(app: FastifyInstance, pool: Pool | null, ctx: Ctx) {
  const org = (req:any) => ctx.dbOrganizationId(req);
  const write = (req:any) => ctx.requireAuthorizedWrite(req);

  async function listModule(module:string, req:any, publicOnly=false){
    const cfg=MODULES[module]; if(!cfg) throw Object.assign(new Error('Unsupported Phase 4/5 module.'),{statusCode:404});
    if(!pool) return {data:[],count:0,module};
    const organizationId=org(req); if(!organizationId && !publicOnly) throw Object.assign(new Error('Organization context is required.'),{statusCode:400});
    const values:any[]=[];
    const where:string[]=[];
    const orgPredicate=cfg.organizationPredicate||`${cfg.alias}.organization_id`;
    const syntheticOrg='(SELECT organization_id FROM patients WHERE patient_number LIKE \'TEST-%\' LIMIT 1)';
    values.push(organizationId || null);
    where.push(`${orgPredicate}=${organizationId ? '$1' : syntheticOrg}`);
    if(publicOnly && cfg.publicFilter) where.push(cfg.publicFilter);
    else if(publicOnly && cfg.patientJoin) where.push(`p.patient_number LIKE 'TEST-%'`);
    const q=String(req.query?.q||'').trim();
    if(values[0]===null) values.shift();
    if(q){values.push(`%${q}%`);where.push(`(${cfg.searchColumns.map(c=>`CAST(${c} AS TEXT) ILIKE $${values.length}`).join(' OR ')})`);}
    const status=String(req.query?.status||'').trim();
    if(status && cfg.statusColumn){values.push(status);where.push(`${cfg.statusColumn}=$${values.length}`);}
    const patientNumber=String(req.query?.patientNumber||'').trim();
    if(patientNumber && cfg.patientJoin){values.push(patientNumber);where.push(`p.patient_number=$${values.length}`);}
    const fromDate=String(req.query?.from||'').trim();
    if(fromDate){values.push(fromDate);where.push(`${cfg.dateColumn}>=$${values.length}::timestamptz`);}
    const toDate=String(req.query?.to||'').trim();
    if(toDate){values.push(toDate);where.push(`${cfg.dateColumn}<$${values.length}::timestamptz`);}
    const limit=Math.min(Math.max(Number(req.query?.limit||250),1),500);
    values.push(limit);
    const join=cfg.patientJoin||'';
    const facilityJoin=cfg.facilityJoin||'';
    const sql=`SELECT ${cfg.select}, count(*) OVER()::int AS __total FROM ${cfg.table} ${cfg.alias} ${join} ${facilityJoin} WHERE ${where.join(' AND ')} ORDER BY ${cfg.orderBy} LIMIT $${values.length}`;
    const r=await pool.query(sql,values);
    const count=r.rows[0]?.__total||0; const data=r.rows.map((x:any)=>{const y={...x};delete y.__total;return y;});
    return {data,count,module};
  }

  async function dashboard(module:string, req:any, publicOnly=false){
    const cfg=MODULES[module]; if(!cfg) throw Object.assign(new Error('Unsupported Phase 4/5 module.'),{statusCode:404});
    if(!pool)return {summary:{total:0},trend:[],breakdown:[]};
    const requestedOrganizationId=org(req);
    const organizationId=requestedOrganizationId || (await pool.query(`SELECT organization_id FROM patients WHERE patient_number LIKE 'TEST-%' LIMIT 1`)).rows[0]?.organization_id;
    if(!organizationId)throw Object.assign(new Error('Organization context is required.'),{statusCode:400});
    const join=cfg.patientJoin||''; const facilityJoin=cfg.facilityJoin||'';
    const orgPredicate=(cfg.organizationPredicate||`${cfg.alias}.organization_id`);
    const whereParts=[`${orgPredicate}=$1`];
    if(publicOnly && cfg.publicFilter) whereParts.push(cfg.publicFilter);
    else if(publicOnly && cfg.patientJoin) whereParts.push(`p.patient_number LIKE 'TEST-%'`);
    const where=whereParts.join(' AND ');
        const trendOrgPredicate=cfg.organizationPredicate ? replaceQualifiedAlias(cfg.organizationPredicate,cfg.alias,'x') : 'x.organization_id';
    const trendPublic=(publicOnly && cfg.publicFilter ? ` AND ${replaceQualifiedAlias(cfg.publicFilter,cfg.alias,'x')}` : (publicOnly && cfg.patientJoin ? ` AND EXISTS (SELECT 1 FROM patients p2 WHERE p2.id=x.patient_id AND p2.patient_number LIKE 'TEST-%')` : ''));
    const [trend,breakdown,total]=await Promise.all([
      pool.query(`SELECT to_char(d.day_date,'YYYY-MM-DD') AS day,count(x.id)::int AS count FROM generate_series(current_date-13,current_date,interval '1 day') AS d(day_date) LEFT JOIN ${cfg.table} x ON date_trunc('day',${replaceQualifiedAlias(cfg.dateColumn,cfg.alias,'x')})=date_trunc('day',d.day_date::timestamptz) AND ${trendOrgPredicate}=$1${trendPublic} GROUP BY d.day_date ORDER BY d.day_date`,[organizationId]),
      cfg.breakdownColumn?pool.query(`SELECT COALESCE(CAST(${cfg.breakdownColumn} AS TEXT),'Not recorded') AS label,count(*)::int AS count FROM ${cfg.table} ${cfg.alias} ${join} ${facilityJoin} WHERE ${where} GROUP BY ${cfg.breakdownColumn} ORDER BY count(*) DESC LIMIT 12`,[organizationId]):Promise.resolve({rows:[]}),
      pool.query(`SELECT count(*)::int AS total FROM ${cfg.table} ${cfg.alias} ${join} ${facilityJoin} WHERE ${where}`,[organizationId])
    ]);
    const extra:Record<string,any>={total:total.rows[0]?.total||0};
    switch(module){
      case 'emergency': { const r=await pool.query(`SELECT count(*) FILTER(WHERE e.status IN ('arrived','assessed'))::int AS waiting,count(*) FILTER(WHERE e.acuity='emergency' AND e.status NOT IN ('discharged'))::int AS emergency_open,count(*) FILTER(WHERE e.disposition IS NOT NULL)::int AS dispositions,round(avg(EXTRACT(EPOCH FROM (e.disposition_at-e.arrival_at))/60) FILTER(WHERE e.disposition_at IS NOT NULL)::numeric,1) AS avg_minutes FROM emergency_cases e WHERE e.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'inpatient': { const r=await pool.query(`SELECT count(*) FILTER(WHERE a.status='admitted')::int AS active_admissions,count(*) FILTER(WHERE a.status='discharged' AND a.discharged_at>=current_date)::int AS discharges_today,round(avg(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at,now())-a.admitted_at))/86400)::numeric,1) AS avg_length_days FROM admissions a WHERE a.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'beds': { const r=await pool.query(`SELECT count(*) FILTER(WHERE b.status='occupied')::int AS occupied,count(*) FILTER(WHERE b.status='available')::int AS available,count(*) FILTER(WHERE b.status='cleaning')::int AS cleaning,count(*) FILTER(WHERE lower(COALESCE(b.metadata->>'isolation','false')) IN ('true','yes','1'))::int AS isolation FROM facility_beds b WHERE b.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'nursing': { const r=await pool.query(`SELECT count(*) FILTER(WHERE n.status='completed')::int AS completed,count(*) FILTER(WHERE n.status='reviewed')::int AS reviewed,count(*) FILTER(WHERE jsonb_array_length(CASE WHEN jsonb_typeof(n.risk_flags)='array' THEN n.risk_flags ELSE '[]'::jsonb END)>0)::int AS risk_assessments FROM nursing_assessments n WHERE n.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'surgery': { const r=await pool.query(`SELECT count(*) FILTER(WHERE s.status IN ('planned','scheduled'))::int AS scheduled,count(*) FILTER(WHERE s.status='in-progress')::int AS in_progress,count(*) FILTER(WHERE s.status='completed')::int AS completed,count(*) FILTER(WHERE s.status IN ('planned','scheduled') AND s.consent_confirmed=false)::int AS consent_gaps FROM surgery_cases s WHERE s.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'maternity': { const r=await pool.query(`SELECT count(*) FILTER(WHERE m.status='active')::int AS active_events,count(*) FILTER(WHERE lower(m.event_type) IN ('birth','delivery','delivery-completed'))::int AS births,count(DISTINCT m.patient_id) FILTER(WHERE m.status='active')::int AS active_patients FROM maternity_records m WHERE m.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'pediatrics': { const r=await pool.query(`SELECT count(*) FILTER(WHERE a.referral_required)::int AS referral_required,count(*) FILTER(WHERE lower(COALESCE(a.nutrition_status,'')) IN ('moderate','severe','malnutrition'))::int AS nutrition_alerts,round(avg(a.age_months)::numeric,1) AS avg_age_months FROM pediatric_assessments a WHERE a.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'child-health': { const r=await pool.query(`SELECT count(*) FILTER(WHERE c.referral_required)::int AS referrals,count(*) FILTER(WHERE jsonb_typeof(c.danger_signs)='object' AND c.danger_signs <> '{}'::jsonb)::int AS danger_sign_records,count(DISTINCT c.patient_id)::int AS children_seen FROM child_health_visits c WHERE c.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'immunization': { const r=await pool.query(`SELECT count(*) FILTER(WHERE i.status='given')::int AS given,count(*) FILTER(WHERE i.status='due')::int AS due,count(*) FILTER(WHERE i.status='missed')::int AS missed,count(*) FILTER(WHERE i.next_due_at BETWEEN now() AND now()+interval '30 days')::int AS due_30_days FROM immunizations i WHERE i.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'chronic-care': { const r=await pool.query(`SELECT count(*) FILTER(WHERE c.status='uncontrolled')::int AS uncontrolled,count(*) FILTER(WHERE c.status IN ('active','stable'))::int AS active_conditions,count(*) FILTER(WHERE c.next_review_at IS NOT NULL AND c.next_review_at<now() AND c.status<>'resolved')::int AS overdue_reviews FROM chronic_care_records c WHERE c.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'consents': { const r=await pool.query(`SELECT count(*) FILTER(WHERE c.status='active')::int AS active,count(*) FILTER(WHERE c.expires_at IS NOT NULL AND c.expires_at BETWEEN now() AND now()+interval '30 days')::int AS expiring_30_days,count(*) FILTER(WHERE c.status='withdrawn')::int AS withdrawn FROM patient_consents c WHERE c.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'referrals': { const r=await pool.query(`SELECT count(*) FILTER(WHERE r.status IN ('sent','accepted','in-progress'))::int AS open,count(*) FILTER(WHERE r.urgency='urgent')::int AS urgent,count(*) FILTER(WHERE r.status='completed')::int AS completed,round(avg(EXTRACT(EPOCH FROM (COALESCE(r.completed_at,now())-r.requested_at))/86400) FILTER(WHERE r.completed_at IS NOT NULL)::numeric,1) AS avg_days FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'referral-network': { const r=await pool.query(`SELECT count(*) FILTER(WHERE n.status='active')::int AS active,count(*) FILTER(WHERE n.status='restricted')::int AS restricted,round(avg(n.typical_wait_minutes)::numeric,1) AS avg_wait_minutes FROM referral_network_nodes n WHERE n.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'care-gaps': { const r=await pool.query(`SELECT count(*) FILTER(WHERE g.status IN ('open','acknowledged','in-review'))::int AS open,count(*) FILTER(WHERE lower(g.severity) IN ('critical','high'))::int AS high_priority,round(avg(EXTRACT(EPOCH FROM (COALESCE(g.closed_at,now())-g.detected_at))/86400) FILTER(WHERE g.status='resolved')::numeric,1) AS avg_days_to_close FROM care_gap_snapshots g WHERE g.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'patient-portal': { const r=await pool.query(`SELECT count(*) FILTER(WHERE a.status='active')::int AS active,count(*) FILTER(WHERE a.status='pending')::int AS pending,count(*) FILTER(WHERE a.last_login_at IS NOT NULL AND a.last_login_at>=now()-interval '30 days')::int AS active_30_days FROM patient_portal_accounts a WHERE a.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'portal-messages': { const r=await pool.query(`SELECT count(*) FILTER(WHERE m.status IN ('draft','queued','sent'))::int AS open,count(*) FILTER(WHERE m.status='delivered')::int AS delivered,count(*) FILTER(WHERE m.direction='inbound' AND m.read_at IS NULL)::int AS unread_inbound FROM portal_messages m WHERE m.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'telemedicine': { const r=await pool.query(`SELECT count(*) FILTER(WHERE t.status IN ('scheduled','waiting'))::int AS upcoming,count(*) FILTER(WHERE t.status='active')::int AS active,count(*) FILTER(WHERE t.status='completed')::int AS completed,count(*) FILTER(WHERE t.identity_verified=false OR t.consent_confirmed=false)::int AS safety_checks FROM telemedicine_sessions t WHERE t.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
      case 'remote-monitoring': { const r=await pool.query(`SELECT count(*) FILTER(WHERE lower(COALESCE(r.alert_status,'')) IN ('critical','high','warning'))::int AS alerts,count(*) FILTER(WHERE r.validation_status NOT IN ('validated','valid'))::int AS unvalidated,count(DISTINCT r.metric)::int AS metrics,count(DISTINCT r.patient_id)::int AS monitored_patients FROM remote_monitoring_readings r WHERE r.organization_id=$1`,[organizationId]);Object.assign(extra,r.rows[0]||{});break; }
    }
    return {summary:extra,trend:trend.rows,breakdown:breakdown.rows};
  }

  async function createModule(module:string, req:any){
    write(req); if(!pool) throw Object.assign(new Error('Clinical data service is unavailable.'),{statusCode:501});
    const organizationId=org(req); if(!organizationId)throw Object.assign(new Error('Organization context is required.'),{statusCode:400});
    const body:any=req.body||{}; const client=await pool.connect();
    try{await client.query('BEGIN');let row:any;let event:string='phase45.record.created';
      if(module==='emergency'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO emergency_cases(organization_id,patient_id,encounter_id,acuity,chief_complaint,triage_level,status,arrival_at,disposition,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()),$9,$10,$11) RETURNING *`,[organizationId,patientId,body.encounterId||null,str(body.acuity)||'urgent',str(body.chiefComplaint),str(body.triageLevel),str(body.status)||'arrived',body.arrivalAt||null,str(body.disposition),jsonValue(body.notes,{}),ctx.dbUserId(req)]); event='emergency.arrived';
      } else if(module==='inpatient'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO admissions(organization_id,patient_id,encounter_id,ward,bed,status,admitted_at,discharge_summary,created_by) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,now()),$8,$9) RETURNING *`,[organizationId,patientId,body.encounterId||null,str(body.ward),str(body.bed),str(body.status)||'admitted',body.admittedAt||null,str(body.dischargeSummary),ctx.dbUserId(req)]); event='inpatient.admitted';
      } else if(module==='beds'){
        const facilityId=assertUuid(body.facilityId,'Facility'); if(!await facilityBelongs(client,facilityId,organizationId))throw Object.assign(new Error('Facility does not belong to this workspace.'),{statusCode:409});
        const status=['available','occupied','reserved','cleaning','blocked'].includes(String(body.status))?String(body.status):'available';
        const patientId=body.patientId?assertUuid(body.patientId,'Patient'):null; if(patientId&&!await patientBelongs(client,patientId,organizationId))throw Object.assign(new Error('Patient does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO facility_beds(organization_id,facility_id,ward,room,bed_number,bed_type,status,patient_id,admission_id,observed_at,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,now()),$11) RETURNING *`,[organizationId,facilityId,str(body.ward)||'General',str(body.room),str(body.bedNumber)||'1',str(body.bedType)||'standard',status,patientId,body.admissionId||null,body.observedAt||null,jsonValue(body.metadata,{})]); event='bed.created';
      } else if(module==='nursing'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO nursing_assessments(organization_id,patient_id,encounter_id,nurse_user_id,assessment_type,findings,pain_score,risk_flags,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[organizationId,patientId,body.encounterId||null,body.nurseUserId||ctx.dbUserId(req),str(body.assessmentType)||'routine',jsonValue(body.findings,{}),num(body.painScore),jsonValue(body.riskFlags,{}),str(body.status)||'draft']); event='nursing.assessment.recorded';
      } else if(module==='surgery'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO surgery_cases(organization_id,patient_id,encounter_id,procedure_name,scheduled_at,status,consent_confirmed,surgeon_user_id,anaesthesia_plan,checklist,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[organizationId,patientId,body.encounterId||null,str(body.procedureName)||'Procedure',body.scheduledAt||null,str(body.status)||'planned',Boolean(body.consentConfirmed),body.surgeonUserId||null,str(body.anaesthesiaPlan),jsonValue(body.checklist,{}),jsonValue(body.notes,{})]); event='surgery.planned';
      } else if(module==='maternity'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO maternity_records(organization_id,patient_id,encounter_id,pregnancy_id,event_type,gestational_age_weeks,gravida,para,maternal_observations,fetal_observations,status,event_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,now()),$13) RETURNING *`,[organizationId,patientId,body.encounterId||null,body.pregnancyId||null,str(body.eventType)||'ANC',num(body.gestationalAgeWeeks),body.gravida===undefined?null:Number(body.gravida),body.para===undefined?null:Number(body.para),jsonValue(body.maternalObservations,{}),jsonValue(body.fetalObservations,{}),str(body.status)||'active',body.eventAt||null,str(body.notes)]); event='maternity.event.recorded';
      } else if(module==='pediatrics'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO pediatric_assessments(organization_id,patient_id,encounter_id,age_months,weight_kg,height_cm,muac_mm,temperature,respiratory_rate,spo2,assessment,imci_classification,nutrition_status,referral_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[organizationId,patientId,body.encounterId||null,body.ageMonths===undefined?null:Number(body.ageMonths),num(body.weightKg),num(body.heightCm),num(body.muacMm),num(body.temperature),num(body.respiratoryRate),num(body.spo2),jsonValue(body.assessment,{}),jsonValue(body.imciClassification,{}),str(body.nutritionStatus),Boolean(body.referralRequired)]); event='pediatrics.assessment.recorded';
      } else if(module==='child-health'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO child_health_visits(organization_id,patient_id,encounter_id,visit_date,age_days,age_months,weight_kg,length_height_cm,head_circumference_cm,muac_mm,temperature_c,respiratory_rate,spo2,feeding_assessment,developmental_assessment,danger_signs,clinical_assessment,plan,referral_required,source_guideline,created_by) VALUES($1,$2,$3,COALESCE($4,now()),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,[organizationId,patientId,body.encounterId||null,body.visitDate||null,body.ageDays===undefined?null:Number(body.ageDays),body.ageMonths===undefined?null:Number(body.ageMonths),num(body.weightKg),num(body.lengthHeightCm),num(body.headCircumferenceCm),num(body.muacMm),num(body.temperatureC),num(body.respiratoryRate),num(body.spo2),jsonValue(body.feedingAssessment,{}),jsonValue(body.developmentalAssessment,{}),jsonValue(body.dangerSigns,{}),jsonValue(body.clinicalAssessment,{}),jsonValue(body.plan,{}),Boolean(body.referralRequired),str(body.sourceGuideline),ctx.dbUserId(req)]); event='child-health.visit.recorded';
      } else if(module==='immunization'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId))throw Object.assign(new Error('Patient does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO immunizations(organization_id,patient_id,vaccine_code,vaccine_name,dose_number,administered_at,lot_number,expiry_date,route,site,vaccinator_user_id,status,next_due_at,notes) VALUES($1,$2,$3,$4,$5,COALESCE($6,now()),$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[organizationId,patientId,str(body.vaccineCode)||str(body.vaccineName)||'UNSPECIFIED',str(body.vaccineName)||'Vaccine',str(body.doseNumber)||'1',body.administeredAt||null,str(body.lotNumber),body.expiryDate||null,str(body.route),str(body.site),body.vaccinatorUserId||ctx.dbUserId(req),str(body.status)||'given',body.nextDueAt||null,str(body.notes)]); event='immunization.recorded';
      } else if(module==='chronic-care'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO chronic_care_records(organization_id,patient_id,encounter_id,condition_code,condition_name,status,goals,measures,medications,next_review_at,risk_level,care_plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[organizationId,patientId,body.encounterId||null,str(body.conditionCode)||'UNSPECIFIED',str(body.conditionName)||'Condition',str(body.status)||'active',jsonValue(body.goals,{}),jsonValue(body.measures,{}),jsonValue(body.medications,{}),body.nextReviewAt||null,str(body.riskLevel),jsonValue(body.carePlan,{})]); event='chronic-care.recorded';
      } else if(module==='consents'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId))throw Object.assign(new Error('Patient does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO patient_consents(organization_id,patient_id,consent_type,version,status,scope,granted_at,expires_at,recorded_by) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,now()),$8,$9) RETURNING *`,[organizationId,patientId,str(body.consentType)||'General',str(body.version)||'1',str(body.status)||'active',jsonValue(body.scope,{}),body.grantedAt||null,body.expiresAt||null,body.recordedBy||ctx.dbUserId(req)]); event='consent.recorded';
      } else if(module==='referrals'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        if(body.destinationFacilityId && !await facilityBelongs(client,assertUuid(body.destinationFacilityId,'Destination facility'),organizationId))throw Object.assign(new Error('Destination facility does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO referrals(patient_id,encounter_id,destination,reason,status,referral_type,service_code,urgency,destination_facility_id,referring_provider_id,clinical_summary,requested_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,now()),now(),now()) RETURNING *`,[patientId,body.encounterId||null,str(body.destination),str(body.reason)||'Continuity referral',str(body.status)||'draft',str(body.referralType)||'clinical',str(body.serviceCode),str(body.urgency)||'routine',body.destinationFacilityId||null,body.referringProviderId||ctx.dbUserId(req),str(body.clinicalSummary),body.requestedAt||null]); event='referral.sent';
      } else if(module==='referral-network'){
        const from=assertUuid(body.fromFacilityId,'Sending facility'); const to=assertUuid(body.toFacilityId,'Receiving facility'); if(!await facilityBelongs(client,from,organizationId)||!await facilityBelongs(client,to,organizationId))throw Object.assign(new Error('Both facilities must belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO referral_network_nodes(organization_id,from_facility_id,to_facility_id,service_code,status,typical_wait_minutes,transport_notes,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[organizationId,from,to,str(body.serviceCode),str(body.status)||'active',body.typicalWaitMinutes===undefined?null:Number(body.typicalWaitMinutes),jsonValue(body.transportNotes,{}),jsonValue(body.metadata,{})]); event='referral-network.link.created';
      } else if(module==='care-gaps'){
        const patientId=body.patientId?assertUuid(body.patientId,'Patient'):null; if(patientId&&!await patientBelongs(client,patientId,organizationId))throw Object.assign(new Error('Patient does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO care_gap_snapshots(organization_id,patient_id,gap_type,severity,status,source_module,evidence,detected_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()),now()) RETURNING *`,[organizationId,patientId,str(body.gapType)||'follow-up',str(body.severity)||'moderate',str(body.status)||'open',str(body.sourceModule)||'continuity',jsonValue(body.evidence,{}),body.detectedAt||null]); event='care-gap.detected';
      } else if(module==='patient-portal'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId))throw Object.assign(new Error('Patient does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO patient_portal_accounts(organization_id,patient_id,email,phone,status,last_login_at,notification_preferences,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now(),now()) RETURNING *`,[organizationId,patientId,str(body.email),str(body.phone),str(body.status)||'pending',body.lastLoginAt||null,jsonValue(body.notificationPreferences,{messages:true,appointments:true,results:true})]); event='portal.account.created';
      } else if(module==='portal-messages'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId))throw Object.assign(new Error('Patient does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO portal_messages(organization_id,patient_id,direction,channel,subject,body,status,sent_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING *`,[organizationId,patientId,str(body.direction)||'outbound',str(body.channel)||'portal',str(body.subject)||'ClinAI message',str(body.body)||'',str(body.status)||'draft',body.sentBy||ctx.dbUserId(req)]); event='portal.message.created';
      } else if(module==='telemedicine'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId)||!await encounterBelongs(client,body.encounterId,patientId,organizationId))throw Object.assign(new Error('Patient or encounter does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO telemedicine_sessions(organization_id,patient_id,appointment_id,encounter_id,scheduled_at,status,meeting_url,identity_verified,consent_confirmed,provider_user_id,notes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) RETURNING *`,[organizationId,patientId,body.appointmentId||null,body.encounterId||null,body.scheduledAt||new Date().toISOString(),str(body.status)||'scheduled',str(body.meetingUrl),Boolean(body.identityVerified),Boolean(body.consentConfirmed),body.providerUserId||ctx.dbUserId(req),jsonValue(body.notes,{})]); event='telemedicine.scheduled';
      } else if(module==='remote-monitoring'){
        const patientId=assertUuid(body.patientId,'Patient'); if(!await patientBelongs(client,patientId,organizationId))throw Object.assign(new Error('Patient does not belong to this workspace.'),{statusCode:409});
        row=await client.query(`INSERT INTO remote_monitoring_readings(organization_id,patient_id,device_id,metric,value_numeric,unit,measured_at,source,validation_status,alert_status,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) RETURNING *`,[organizationId,patientId,str(body.deviceId),str(body.metric)||'measurement',num(body.valueNumeric),str(body.unit),body.measuredAt||new Date().toISOString(),str(body.source)||'manual',str(body.validationStatus)||'pending',str(body.alertStatus)||'normal',jsonValue(body.metadata,{})]); event='remote-monitoring.reading.recorded';
      } else throw Object.assign(new Error('Unsupported Phase 4/5 module.'),{statusCode:404});
      const id=row.rows[0].id;
      await ctx.dbAudit(client,req,'CREATE',module,id,{phase:'4-5'});
      await ctx.queueEvent(client,req,event,{module,entityId:id,patientId:row.rows[0].patient_id||row.rows[0].patientId||null,organizationId});
      await client.query('COMMIT');
      return {data:row.rows[0],module};
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  async function actionModule(module:string,id:string,req:any){
    write(req); if(!pool)throw Object.assign(new Error('Clinical data service is unavailable.'),{statusCode:501});
    const organizationId=org(req); if(!organizationId)throw Object.assign(new Error('Organization context is required.'),{statusCode:400});
    const body:any=req.body||{}; const action=String(body.action||'').trim(); const client=await pool.connect();
    try{await client.query('BEGIN');let row:any;let event=`${module}.${action}`;
      if(module==='emergency'){
        const map:any={assess:'assessed',treat:'treated',admit:'admitted',discharge:'discharged'};if(!map[action])throw Object.assign(new Error('Unsupported emergency action.'),{statusCode:400});
        const existing=await client.query(`SELECT * FROM emergency_cases WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,organizationId]);if(!existing.rowCount)throw Object.assign(new Error('Emergency case not found.'),{statusCode:404});
        row=await client.query(`UPDATE emergency_cases SET status=$1,disposition=COALESCE($2,disposition),disposition_at=CASE WHEN $1='discharged' THEN now() ELSE disposition_at END,updated_at=now() WHERE id=$3 AND organization_id=$4 RETURNING *`,[map[action],action==='discharge'?str(body.disposition):null,id,organizationId]);
        if(action==='admit'){const e=existing.rows[0];const active=await client.query(`SELECT id FROM admissions WHERE patient_id=$1 AND organization_id=$2 AND status='admitted' LIMIT 1`,[e.patient_id,organizationId]);if(!active.rowCount){await client.query(`INSERT INTO admissions(organization_id,patient_id,encounter_id,status,admitted_at,created_by,created_at,updated_at) VALUES($1,$2,$3,'admitted',now(),$4,now(),now())`,[organizationId,e.patient_id,e.encounter_id||null,ctx.dbUserId(req)]);}}
      } else if(module==='inpatient'){
        if(!['discharge','transfer'].includes(action))throw Object.assign(new Error('Unsupported inpatient action.'),{statusCode:400});
        const s=await client.query(`SELECT * FROM admissions WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,organizationId]);if(!s.rowCount)throw Object.assign(new Error('Admission not found.'),{statusCode:404});
        const next=action==='discharge'?'discharged':'transferred'; row=await client.query(`UPDATE admissions SET status=$1,discharged_at=CASE WHEN $1='discharged' THEN now() ELSE discharged_at END,discharge_summary=COALESCE($2,discharge_summary),updated_at=now() WHERE id=$3 AND organization_id=$4 RETURNING *`,[next,str(body.dischargeSummary),id,organizationId]);
        if(action==='discharge')await client.query(`UPDATE facility_beds SET status='cleaning',patient_id=NULL,admission_id=NULL,observed_at=now() WHERE admission_id=$1 AND organization_id=$2`,[id,organizationId]);
      } else if(module==='beds'){
        if(!['assign','release','available','block','reserve'].includes(action))throw Object.assign(new Error('Unsupported bed action.'),{statusCode:400});
        const bed=await client.query(`SELECT * FROM facility_beds WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,organizationId]);if(!bed.rowCount)throw Object.assign(new Error('Bed not found.'),{statusCode:404});
        if(action==='assign'){const pid=assertUuid(body.patientId,'Patient');if(!await patientBelongs(client,pid,organizationId))throw Object.assign(new Error('Patient does not belong to this workspace.'),{statusCode:409});row=await client.query(`UPDATE facility_beds SET status='occupied',patient_id=$1,admission_id=$2,observed_at=now() WHERE id=$3 RETURNING *`,[pid,body.admissionId||null,id]);} else {const next={release:'cleaning',available:'available',block:'blocked',reserve:'reserved'}[action];row=await client.query(`UPDATE facility_beds SET status=$1,patient_id=CASE WHEN $1 IN ('available','cleaning','blocked','reserved') THEN NULL ELSE patient_id END,admission_id=CASE WHEN $1 IN ('available','cleaning','blocked','reserved') THEN NULL ELSE admission_id END,observed_at=now() WHERE id=$2 RETURNING *`,[next,id]);}
      } else if(module==='nursing'){
        if(!['complete','review'].includes(action))throw Object.assign(new Error('Unsupported nursing action.'),{statusCode:400}); const next=action==='complete'?'completed':'reviewed';row=await client.query(`UPDATE nursing_assessments SET status=$1 WHERE id=$2 AND organization_id=$3 RETURNING *`,[next,id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Nursing assessment not found.'),{statusCode:404});
      } else if(module==='surgery'){
        const map:any={schedule:'scheduled',start:'in-progress',complete:'completed',cancel:'cancelled'}; if(action==='confirm-consent'){row=await client.query(`UPDATE surgery_cases SET consent_confirmed=true,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,[id,organizationId]);} else if(map[action]){row=await client.query(`UPDATE surgery_cases SET status=$1,updated_at=now() WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);} else throw Object.assign(new Error('Unsupported surgery action.'),{statusCode:400});if(!row.rowCount)throw Object.assign(new Error('Surgery case not found.'),{statusCode:404});
      } else if(module==='maternity'){
        const map:any={complete:'completed',cancel:'cancelled'}; if(!map[action])throw Object.assign(new Error('Unsupported maternity action.'),{statusCode:400});row=await client.query(`UPDATE maternity_records SET status=$1 WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Maternity record not found.'),{statusCode:404});
      } else if(module==='pediatrics'||module==='child-health'){
        if(action!=='review')throw Object.assign(new Error('Only review acknowledgement is supported for this assessment type.'),{statusCode:400});
        const cfg=MODULES[module];const r=await client.query(`UPDATE ${cfg.table} SET reviewed_at=now(),reviewed_by=$1 WHERE id=$2 AND organization_id=$3 RETURNING *`,[ctx.dbUserId(req),id,organizationId]);if(!r.rowCount)throw Object.assign(new Error('Child health record not found.'),{statusCode:404});row=r;
      } else if(module==='immunization'){
        const map:any={administer:'given','missed':'missed','cancel':'cancelled'};if(!map[action])throw Object.assign(new Error('Unsupported immunization action.'),{statusCode:400});const admin=action==='administer'?new Date().toISOString():undefined;row=await client.query(`UPDATE immunizations SET status=$1,administered_at=COALESCE($2,administered_at) WHERE id=$3 AND organization_id=$4 RETURNING *`,[map[action],admin,id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Immunization record not found.'),{statusCode:404});
      } else if(module==='chronic-care'){
        const map:any={uncontrolled:'uncontrolled',stabilize:'stable',resolve:'resolved',activate:'active'};if(!map[action])throw Object.assign(new Error('Unsupported chronic care action.'),{statusCode:400});row=await client.query(`UPDATE chronic_care_records SET status=$1,updated_at=now() WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Chronic care record not found.'),{statusCode:404});
      } else if(module==='consents'){
        const map:any={withdraw:'withdrawn',expire:'expired',renew:'active'};if(!map[action])throw Object.assign(new Error('Unsupported consent action.'),{statusCode:400});row=await client.query(`UPDATE patient_consents SET status=$1${action==='renew'?',granted_at=now()':''} WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Consent not found.'),{statusCode:404});
      } else if(module==='referrals'){
        const map:any={send:'sent',accept:'accepted',complete:'completed',cancel:'cancelled',close:'closed'};if(!map[action])throw Object.assign(new Error('Unsupported referral action.'),{statusCode:400});row=await client.query(`UPDATE referrals r SET status=$1,accepted_at=CASE WHEN $1='accepted' THEN now() ELSE r.accepted_at END,completed_at=CASE WHEN $1='completed' THEN now() ELSE r.completed_at END,updated_at=now() FROM patients p WHERE r.id=$2 AND p.id=r.patient_id AND p.organization_id=$3 RETURNING r.*`,[map[action],id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Referral not found.'),{statusCode:404});
      } else if(module==='referral-network'){
        const map:any={activate:'active',restrict:'restricted',deactivate:'inactive'};if(!map[action])throw Object.assign(new Error('Unsupported referral network action.'),{statusCode:400});row=await client.query(`UPDATE referral_network_nodes SET status=$1 WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Referral network link not found.'),{statusCode:404});
      } else if(module==='care-gaps'){
        const map:any={resolve:'resolved',acknowledge:'acknowledged',reopen:'open'};if(!map[action])throw Object.assign(new Error('Unsupported care-gap action.'),{statusCode:400});row=await client.query(`UPDATE care_gap_snapshots SET status=$1,closed_at=CASE WHEN $1='resolved' THEN now() ELSE NULL END WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Care gap not found.'),{statusCode:404});
      } else if(module==='patient-portal'){
        const map:any={activate:'active',suspend:'suspended',close:'closed'};if(!map[action])throw Object.assign(new Error('Unsupported patient portal action.'),{statusCode:400});row=await client.query(`UPDATE patient_portal_accounts SET status=$1,updated_at=now() WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Patient portal account not found.'),{statusCode:404});
      } else if(module==='portal-messages'){
        if(action==='read'){row=await client.query(`UPDATE portal_messages SET read_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,[id,organizationId]);}
        else {const map:any={queue:'queued',send:'sent',deliver:'delivered',fail:'failed'};if(!map[action])throw Object.assign(new Error('Unsupported portal message action.'),{statusCode:400});row=await client.query(`UPDATE portal_messages SET status=$1,read_at=CASE WHEN $1='delivered' THEN COALESCE(read_at,now()) ELSE read_at END WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);}
        if(!row.rowCount)throw Object.assign(new Error('Portal message not found.'),{statusCode:404});
      } else if(module==='telemedicine'){
        const map:any={wait:'waiting',start:'active',end:'completed',cancel:'cancelled'};if(action==='verify-identity'){row=await client.query(`UPDATE telemedicine_sessions SET identity_verified=true WHERE id=$1 AND organization_id=$2 RETURNING *`,[id,organizationId]);} else if(action==='confirm-consent'){row=await client.query(`UPDATE telemedicine_sessions SET consent_confirmed=true WHERE id=$1 AND organization_id=$2 RETURNING *`,[id,organizationId]);} else if(map[action]){row=await client.query(`UPDATE telemedicine_sessions SET status=$1,started_at=CASE WHEN $1='active' THEN now() ELSE started_at END,ended_at=CASE WHEN $1='completed' THEN now() ELSE ended_at END WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);} else throw Object.assign(new Error('Unsupported telemedicine action.'),{statusCode:400});if(!row.rowCount)throw Object.assign(new Error('Telemedicine session not found.'),{statusCode:404});
      } else if(module==='remote-monitoring'){
        const map:any={'ack-alert':'acknowledged','clear-alert':'normal'};if(!map[action] || !['normal','critical','high','warning','acknowledged'].includes(String(map[action])))throw Object.assign(new Error('Unsupported monitoring action.'),{statusCode:400});row=await client.query(`UPDATE remote_monitoring_readings SET alert_status=$1 WHERE id=$2 AND organization_id=$3 RETURNING *`,[map[action],id,organizationId]);if(!row.rowCount)throw Object.assign(new Error('Monitoring reading not found.'),{statusCode:404});
      } else throw Object.assign(new Error('Unsupported Phase 4/5 module.'),{statusCode:404});
      const returned=row.rows[0];
      await ctx.dbAudit(client,req,'UPDATE',module,id,{phase:'4-5',action});
      await ctx.queueEvent(client,req,event,{module,entityId:id,patientId:returned?.patient_id||null,organizationId,action});
      await client.query('COMMIT');return {data:returned,module,action};
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  for(const module of Object.keys(MODULES)){
    app.get(`/api/phase45/${module}`,async(req:any,reply:any)=>{try{return await listModule(module,req,false)}catch(e:any){return reply.code(e.statusCode||500).send({error:e.message||'Unable to load clinical workspace.'})}});
    app.get(`/api/phase45/${module}/dashboard`,async(req:any,reply:any)=>{try{return await dashboard(module,req)}catch(e:any){return reply.code(e.statusCode||500).send({error:e.message||'Unable to load clinical dashboard.'})}});
    app.post(`/api/phase45/${module}`,async(req:any,reply:any)=>{try{return reply.code(201).send(await createModule(module,req))}catch(e:any){return reply.code(e.statusCode||500).send({error:e.message||'Unable to create clinical record.'})}});
    app.post(`/api/phase45/${module}/:id/action`,async(req:any,reply:any)=>{try{return await actionModule(module,String(req.params.id),req)}catch(e:any){return reply.code(e.statusCode||500).send({error:e.message||'Clinical action could not be completed.'})}});
    app.get(`/api/public/test-phase45/${module}`,async(req:any,reply:any)=>{try{return await listModule(module,req,true)}catch(e:any){return reply.code(e.statusCode||500).send({error:e.message||'Unable to load synthetic clinical workspace.'})}});
    app.get(`/api/public/test-phase45/${module}/dashboard`,async(req:any,reply:any)=>{try{return await dashboard(module,req,true)}catch(e:any){return reply.code(e.statusCode||500).send({error:e.message||'Unable to load synthetic clinical dashboard.'})}});
  }
}
