import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const api=fs.readFileSync(path.join(root,'services/api/src/routes/acuteCareRoutes.ts'),'utf8');
const main=fs.readFileSync(path.join(root,'services/api/src/main.ts'),'utf8');
const web=fs.readFileSync(path.join(root,'apps/web/app/page.tsx'),'utf8');
const contracts=JSON.parse(fs.readFileSync(path.join(root,'packages/module-contracts/contracts.json'),'utf8'));
const migration=fs.readFileSync(path.join(root,'database/migrations/033-phase4-5-acute-continuity-depth.sql'),'utf8').toLowerCase();
const phase4=['emergency','inpatient','beds','nursing','surgery','maternity','pediatrics','child-health'];
const phase5=['chronic-care','immunization','consents','referrals','referral-network','care-gaps','patient-portal','portal-messages','telemedicine','remote-monitoring'];
const modules=[...phase4,...phase5];
const bad=/\b(drop|truncate|delete\s+from|alter\s+table[^\n;]*(drop|replace))\b/i;
if(bad.test(migration)) throw new Error('Phase 4/5 migration contains destructive SQL');
if(!api.includes('registerPhase45AcuteContinuityRoutes')) throw new Error('Phase 4/5 route registration missing');
if(!main.includes("phase45AcuteContinuity.js")) throw new Error('Phase 4/5 import missing');
for(const m of modules){
  if(m==='referrals'){ const c=contracts.modules.find(x=>x.id===m); if(c?.backend?.endpoint!=='/api/core-clinical/referrals' || c?.identity?.contractVersion!=='2.1.0') throw new Error('Referrals must remain on the Phase 2 authoritative contract.'); continue; }
  if(!api.includes('const MODULES') || !api.includes('app.get(`/api/phase45/${module}`') || !api.includes('app.get(`/api/public/test-phase45/${module}`')) throw new Error('Phase 4/5 dynamic route families missing');
  if(!web.includes(`'${m}'`) && !web.includes(`'${m}`)) throw new Error(`Frontend module ${m} not registered`);
  const c=contracts.modules.find(x=>x.id===m); if(!c) throw new Error(`Contract missing ${m}`);
  if(c.backend?.endpoint!==`/api/phase45/${m}`) throw new Error(`Contract endpoint mismatch ${m}`);
  if(!Array.isArray(c.actions)||!c.actions.includes('create')||!c.actions.includes('view')) throw new Error(`Contract actions incomplete ${m}`);
  if(!Array.isArray(c.fields)||c.fields.length<3) throw new Error(`Contract fields too shallow ${m}`);
}
for(const token of ['Create','Details','Refresh','Patient 360','phase45MetricCards','PHASE45_STATUS_FILTERS']) if(!web.includes(token)) throw new Error(`Phase 4/5 UX check missing ${token}`);
for(const token of ['patientBelongs','encounterBelongs','facilityBelongs','dbAudit','queueEvent']) if(!api.includes(token)) throw new Error(`Safety/connectivity helper missing ${token}`);
for(const table of ['emergency_cases','admissions','facility_beds','nursing_assessments','surgery_cases','maternity_records','pediatric_assessments','child_health_visits','immunizations','chronic_care_records','patient_consents','referrals','referral_network_nodes','care_gap_snapshots','patient_portal_accounts','portal_messages','telemedicine_sessions','remote_monitoring_readings']) if(!migration.includes(`on ${table}`)) throw new Error(`Missing migration coverage for ${table}`);
console.log(`PHASE45_5_PASS modules=${modules.length} phase4=${phase4.length} phase5=${phase5.length} referralReusedFromPhase2=true`);
