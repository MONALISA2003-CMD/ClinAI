import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Pool } from 'pg';

const app = Fastify({ logger: true });
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) : null;
await app.register(cors, { origin: true });
await app.register(jwt, { secret: process.env.JWT_SECRET || 'clinai-local-development-secret' });

const modules = ['command-center','patients','patient-contacts','emergency-contacts','allergies','appointments','registration','queue','triage','encounters','clinical-notes','diagnoses','orders','laboratory','imaging','pharmacy','nursing','emergency','inpatient','surgery','maternity','pediatrics','immunization','care-plans','referrals','follow-up','billing','payments','insurance','claims','inventory','procurement','suppliers','procedures','patient-portal','notifications','telemedicine','remote-monitoring','analytics','population-health','ai','interoperability','trust','staff','facilities','tasks','workflows','beds','chronic-care','accounting','audit','settings','documents'] as const;
type Mod = typeof modules[number];
type Row = Record<string, any>;
const file = process.env.CLINAI_STORE || '.clinai-data/store.json';
const store: Record<string, Row[]> = Object.fromEntries(modules.map(m => [m, []]));
const audit: Row[] = []; const events: Row[] = [];

async function loadStore(){ try { const raw=await readFile(file,'utf8'); const parsed=JSON.parse(raw); for(const m of modules) store[m]=Array.isArray(parsed.store?.[m])?parsed.store[m]:[]; audit.push(...(parsed.audit||[])); events.push(...(parsed.events||[])); } catch {} }
let persistTimer: NodeJS.Timeout|undefined;
function persist(){ clearTimeout(persistTimer); persistTimer=setTimeout(async()=>{await mkdir(dirname(file),{recursive:true}); await writeFile(file,JSON.stringify({store,audit:audit.slice(-2000),events:events.slice(-2000)},null,2));},100); }
await loadStore();

function actor(req:any){ return req.user?.sub || 'system'; }
function org(req:any){ return req.user?.organizationId || 'demo-org'; }
const WRITE_ROLES = new Set(['admin','doctor','nurse','lab','pharmacist','reception','cashier','inventory','manager']);
function canWrite(req:any){ return WRITE_ROLES.has(req.user?.role || ''); }
function now(){ return new Date().toISOString(); }

async function ensureRuntimeSchema(){
  if(!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS module_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      module text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      payload jsonb NOT NULL DEFAULT '{}',
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_module_records_org_module_created ON module_records(organization_id,module,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_module_records_payload_gin ON module_records USING gin(payload);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(organization_id, expires_at);
  `);
}
await ensureRuntimeSchema();
if(pool){
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`);
  await pool.query(`CREATE INDEX IF NOT EXISTS notifications_patient_idx ON notifications(patient_id, created_at DESC)`);
}

async function ensureDemoTenant(){
  if(!pool) return null;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let orgRow=await client.query('SELECT id FROM organizations WHERE name=$1 LIMIT 1',['ClinAI Demo Organization']);
    let organizationId:string;
    if(orgRow.rowCount){ organizationId=orgRow.rows[0].id; }
    else {
      const r=await client.query('INSERT INTO organizations(name,status) VALUES($1,$2) RETURNING id',['ClinAI Demo Organization','active']);
      organizationId=r.rows[0].id;
    }
    let facility=await client.query('SELECT id FROM facilities WHERE organization_id=$1 ORDER BY created_at LIMIT 1',[organizationId]);
    if(!facility.rowCount) await client.query('INSERT INTO facilities(organization_id,name,type) VALUES($1,$2,$3)',[organizationId,'Main Facility','clinic']);
    let user=await client.query('SELECT id FROM users WHERE firebase_uid=$1 LIMIT 1',['demo-user']);
    let userId:string;
    if(user.rowCount) userId=user.rows[0].id;
    else { const r=await client.query('INSERT INTO users(firebase_uid,email,display_name) VALUES($1,$2,$3) RETURNING id',['demo-user','demo@clinai.local','ClinAI Demo User']); userId=r.rows[0].id; }
    let role=await client.query('SELECT id FROM roles WHERE organization_id=$1 AND code=$2',[organizationId,'admin']);
    let roleId:string;
    if(role.rowCount) roleId=role.rows[0].id;
    else { const r=await client.query('INSERT INTO roles(organization_id,code,name) VALUES($1,$2,$3) RETURNING id',[organizationId,'admin','Administrator']); roleId=r.rows[0].id; }
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,roleId]);
    await client.query('COMMIT');
    return {organizationId,userId};
  }catch(e){ await client.query('ROLLBACK'); throw e; }
  finally{ client.release(); }
}
const demoTenant=await ensureDemoTenant();
function dbOrganizationId(req:any){ return req.user?.organizationId || demoTenant?.organizationId || null; }
function dbUserId(req:any){ return req.user?.sub && req.user.sub!=='system' ? req.user.sub : demoTenant?.userId || null; }
async function dbAudit(client:any, req:any, action:string, entityType:string, entityId:string, metadata:Row={}){
  const organizationId=dbOrganizationId(req), actorId=dbUserId(req);
  if(!organizationId) return;
  await client.query('INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[organizationId,actorId,action,entityType,entityId,JSON.stringify(metadata)]);
}
function add(m:Mod, data:Row, req:any){ const row={id:data.id||randomUUID(), organizationId:data.organizationId||org(req), createdAt:data.createdAt||now(), updatedAt:now(), ...data}; store[m].push(row); audit.push({id:randomUUID(),action:'CREATE',module:m,resourceId:row.id,actorId:actor(req),at:now()}); events.push({id:randomUUID(),type:`${m}.created`,payload:row,at:now()}); persist(); return row; }
function patch(m:Mod,id:string,data:Row,req:any){ const row=store[m].find(x=>x.id===id && x.organizationId===req.user?.organizationId); if(!row) return null; Object.assign(row,data,{updatedAt:now()}); audit.push({id:randomUUID(),action:'UPDATE',module:m,resourceId:id,actorId:actor(req),at:now()}); events.push({id:randomUUID(),type:`${m}.updated`,payload:row,at:now()}); persist(); return row; }
function remove(m:Mod,id:string,req:any){ const i=store[m].findIndex(x=>x.id===id && x.organizationId===req.user?.organizationId); if(i<0)return false; store[m].splice(i,1); audit.push({id:randomUUID(),action:'DELETE',module:m,resourceId:id,actorId:actor(req),at:now()}); persist(); return true; }

const patient=z.object({firstName:z.string().min(1),middleName:z.string().optional(),lastName:z.string().min(1),dateOfBirth:z.string().optional(),sex:z.enum(['male','female','intersex','unknown']).optional(),phone:z.string().optional(),email:z.string().email().optional(),nationalId:z.string().optional(),preferredLanguage:z.string().optional(),address:z.union([z.string(),z.record(z.any())]).optional(),facilityId:z.string().uuid().optional()});
const contact=z.object({type:z.string().min(1),value:z.string().min(1),isPrimary:z.boolean().default(false)});
const emergencyContact=z.object({name:z.string().min(1),relationship:z.string().optional(),phone:z.string().optional(),address:z.string().optional()});
const allergy=z.object({substance:z.string().min(1),reaction:z.string().optional(),severity:z.string().optional(),status:z.string().default('active')});
const appointment=z.object({patientId:z.string(),providerId:z.string().optional(),facilityId:z.string().optional(),startAt:z.string(),durationMinutes:z.number().int().positive().default(30),type:z.string().default('consultation'),reason:z.string().optional(),status:z.string().default('scheduled')});
const encounter=z.object({patientId:z.string(),appointmentId:z.string().optional(),providerId:z.string().optional(),facilityId:z.string().optional(),reason:z.string().optional(),type:z.string().default('outpatient'),status:z.string().default('in-progress')});
const order=z.object({patientId:z.string(),encounterId:z.string().optional(),category:z.enum(['laboratory','imaging','medication','procedure']),code:z.string().min(1),description:z.string().optional(),priority:z.enum(['routine','urgent','stat']).default('routine'),details:z.record(z.any()).optional()});
const triage=z.object({patientId:z.string(),encounterId:z.string().optional(),chiefComplaint:z.string().optional(),temperature:z.number().optional(),heartRate:z.number().optional(),respiratoryRate:z.number().optional(),systolic:z.number().optional(),diastolic:z.number().optional(),spo2:z.number().optional(),pain:z.number().min(0).max(10).optional(),acuity:z.enum(['routine','urgent','emergency']).default('routine')});
const generic=z.record(z.any());

app.get('/',async()=>({ok:true,service:'clinai-api',status:'live',health:'/health'}));
app.get('/health',async(_req,reply)=>{
  if(!pool) return reply.code(503).send({ok:false,service:'clinai-api',time:now(),persistence:false,database:{connected:false,engine:'postgresql'}});
  try {
    const r=await pool.query("select count(*)::int as table_count from information_schema.tables where table_schema='public' and table_type='BASE TABLE'");
    return {ok:true,service:'clinai-api',time:now(),persistence:true,database:{connected:true,engine:'postgresql',tableCount:r.rows[0].table_count}};
  } catch {
    return reply.code(503).send({ok:false,service:'clinai-api',time:now(),persistence:false,database:{connected:false,engine:'postgresql'}});
  }
});
app.get('/api/system/status',async(_req,reply)=>{
  if(!pool) return reply.code(503).send({ok:false,service:'clinai-api',database:{connected:false,mode:'json'},message:'DATABASE_URL is not configured'});
  try {
    const r=await pool.query("select count(*)::int as table_count from information_schema.tables where table_schema='public' and table_type='BASE TABLE'");
    return {ok:true,service:'clinai-api',status:'live',database:{connected:true,engine:'postgresql',tableCount:r.rows[0].table_count}};
  } catch {
    return reply.code(503).send({ok:false,service:'clinai-api',status:'degraded',database:{connected:false,engine:'postgresql'}});
  }
});
app.get('/api/modules',async()=>modules);
app.post('/api/auth/demo',async()=>{ if(!demoTenant) return {token:await app.jwt.sign({sub:'demo-user',role:'admin',organizationId:'demo-org'},{expiresIn:'8h'})}; return {token:await app.jwt.sign({sub:demoTenant.userId,role:'admin',organizationId:demoTenant.organizationId},{expiresIn:'8h'}),organizationId:demoTenant.organizationId,userId:demoTenant.userId}; });
app.addHook('preHandler',async(req)=>{
  const publicPath=(req.raw.url||'/').split('?')[0];
  if(publicPath==='/'||publicPath==='/health'||publicPath==='/api/auth/demo') return;
  try{
    await req.jwtVerify();
    if((req.method==='POST'||req.method==='PATCH'||req.method==='DELETE') && !canWrite(req)) throw Object.assign(new Error('Insufficient role permissions'),{statusCode:403});
  }catch(e:any){
    if(e.statusCode) throw e;
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
});
app.addHook('preHandler', async(req:any,reply:any)=>{
  if(!pool || !['POST','PATCH','DELETE'].includes(req.method) || req.raw.url?.startsWith('/api/auth/')) return;
  const key=String(req.headers['idempotency-key']||'').trim(); if(!key) return;
  const oid=dbOrganizationId(req); if(!oid) return;
  const r=await pool.query('SELECT response_code,response_body FROM idempotency_keys WHERE organization_id=$1 AND key=$2 AND (expires_at IS NULL OR expires_at>now())',[oid,key]);
  if(r.rowCount){ req.idempotencyReplay=true; return reply.code(r.rows[0].response_code).send(r.rows[0].response_body); }
  req.idempotencyKey=key;
});
app.addHook('onSend', async(req:any,reply:any,payload:any)=>{
  if(!pool || !req.idempotencyKey || req.idempotencyReplay || reply.statusCode>=500) return;
  try { const body=typeof payload==='string'?JSON.parse(payload):payload; await pool.query(`INSERT INTO idempotency_keys(organization_id,key,response_code,response_body,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT (organization_id,key) DO NOTHING`,[dbOrganizationId(req),req.idempotencyKey,reply.statusCode,JSON.stringify(body)]); } catch {}
});

app.get('/api/dashboard',async(req:any)=>{
  if(!pool){const count=(m:Mod)=>store[m].length;return {patients:count('patients'),appointments:count('appointments'),waiting:store.queue.filter(x=>['waiting','waiting-triage','waiting-doctor'].includes(x.status)).length,criticalLabs:store.laboratory.filter(x=>x.critical).length,openTasks:store.tasks.filter(x=>x.status==='open').length,unpaid:store.billing.filter(x=>x.status!=='paid').length};}
  const oid=dbOrganizationId(req);
  const [p,a,q,l,t,i]=await Promise.all([
    pool.query('SELECT count(*)::int n FROM patients WHERE organization_id=$1',[oid]),
    pool.query('SELECT count(*)::int n FROM appointments WHERE organization_id=$1',[oid]),
    pool.query("SELECT count(*)::int n FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.status IN ('waiting','waiting-triage','waiting-doctor','emergency')",[oid]),
    pool.query("SELECT count(*)::int n FROM module_records WHERE organization_id=$1 AND module='laboratory' AND COALESCE(payload->>'critical','false')='true' AND COALESCE(payload->>'status','') NOT IN ('released','resolved')",[oid]),
    pool.query("SELECT count(*)::int n FROM module_records WHERE organization_id=$1 AND module='tasks' AND COALESCE(payload->>'status','open')='open'",[oid]),
    pool.query("SELECT count(*)::int n FROM invoices WHERE organization_id=$1 AND status <> 'paid'",[oid])
  ]);
  return {patients:p.rows[0].n,appointments:a.rows[0].n,waiting:q.rows[0].n,criticalLabs:l.rows[0].n,openTasks:t.rows[0].n,unpaid:i.rows[0].n};
});
app.get('/api/events',async(req:any)=>{
  if(!pool) return events.slice(-500).reverse();
  const r=await pool.query(`SELECT id,event_type AS "type",aggregate_type AS "aggregateType",aggregate_id AS "aggregateId",payload,status,attempts,available_at AS "availableAt",created_at AS "createdAt" FROM outbox_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);
  return r.rows;
});
app.get('/api/patients',async(req:any)=>{
  if(!pool) return {data:store.patients.filter(x=>x.organizationId===org(req)),count:store.patients.filter(x=>x.organizationId===org(req)).length};
  const q=String(req.query?.q||'').trim(); const params:any[]=[dbOrganizationId(req)];
  let where='p.organization_id=$1';
  if(q){ params.push(`%${q}%`); where += ' AND (p.patient_number ILIKE $2 OR p.first_name ILIKE $2 OR p.last_name ILIKE $2 OR COALESCE(p.phone,\'\') ILIKE $2)'; }
  const r=await pool.query(`SELECT p.id,p.organization_id AS "organizationId",p.facility_id AS "facilityId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.middle_name AS "middleName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.phone,p.email,p.address,p.national_identifier AS "nationalId",p.preferred_language AS "preferredLanguage",p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM patients p WHERE ${where} ORDER BY p.created_at DESC LIMIT 100`,params);
  return {data:r.rows,count:r.rowCount};
});
app.get('/api/patients/:id',async(req:any,reply)=>{
  if(!pool) return reply.code(404).send({error:'Patient not found'});
  const r=await pool.query(`SELECT p.id,p.organization_id AS "organizationId",p.facility_id AS "facilityId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.middle_name AS "middleName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.phone,p.email,p.address,p.national_identifier AS "nationalId",p.preferred_language AS "preferredLanguage",p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM patients p WHERE p.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]);
  if(!r.rowCount) return reply.code(404).send({error:'Patient not found'}); return r.rows[0];
});
app.get('/api/appointments',async(req:any)=>{
  if(!pool) return {data:store.appointments.filter(x=>x.organizationId===org(req)),count:store.appointments.length};
  const params:any[]=[dbOrganizationId(req)]; let where='a.organization_id=$1';
  if(req.query?.patientId){params.push(String(req.query.patientId));where+=' AND a.patient_id=$2';}
  const x=await pool.query(`SELECT a.id,a.organization_id AS "organizationId",a.patient_id AS "patientId",a.provider_user_id AS "providerId",a.facility_id AS "facilityId",a.start_at AS "startAt",a.end_at AS "endAt",a.type,a.status,a.reason,a.created_at AS "createdAt" FROM appointments a WHERE ${where} ORDER BY a.start_at DESC LIMIT 200`,params); return {data:x.rows,count:x.rowCount};
});
app.get('/api/encounters',async(req:any)=>{
  if(!pool) return {data:store.encounters.filter(x=>x.organizationId===org(req)),count:store.encounters.length};
  const params:any[]=[dbOrganizationId(req)]; let where='e.organization_id=$1';
  if(req.query?.patientId){params.push(String(req.query.patientId));where+=' AND e.patient_id=$2';}
  const x=await pool.query(`SELECT e.id,e.organization_id AS "organizationId",e.patient_id AS "patientId",e.appointment_id AS "appointmentId",e.provider_user_id AS "providerId",e.facility_id AS "facilityId",e.type,e.status,e.started_at AS "startedAt",e.ended_at AS "endedAt" FROM encounters e WHERE ${where} ORDER BY e.started_at DESC LIMIT 200`,params); return {data:x.rows,count:x.rowCount};
});
app.post('/api/patients',async(req:any,reply)=>{
  const p=patient.parse(req.body);
  if(!pool) return reply.code(201).send(add('patients',{...p,patientNumber:`CLN-${String(store.patients.length+1).padStart(6,'0')}`,status:'active'},req));
  const client=await pool.connect();
  try{ await client.query('BEGIN');
    const duplicate=await client.query('SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",phone FROM patients WHERE organization_id=$1 AND phone IS NOT NULL AND phone=$2 AND lower(last_name)=lower($3) LIMIT 1',[dbOrganizationId(req),p.phone||null,p.lastName]);
    if(duplicate.rowCount){ await client.query('ROLLBACK'); return reply.code(409).send({error:'Possible duplicate patient',duplicate:duplicate.rows[0]}); }
    const seq=await client.query("SELECT COALESCE(MAX(CASE WHEN patient_number ~ '^CLN-[0-9]+$' THEN substring(patient_number from 5)::integer ELSE 0 END),0)+1 AS n FROM patients WHERE organization_id=$1",[dbOrganizationId(req)]);
    const number=`CLN-${String(seq.rows[0].n).padStart(6,'0')}`;
    const r=await client.query(`INSERT INTO patients(organization_id,facility_id,patient_number,first_name,middle_name,last_name,date_of_birth,sex,phone,email,national_identifier,preferred_language,address) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id,organization_id AS "organizationId",facility_id AS "facilityId",patient_number AS "patientNumber",first_name AS "firstName",middle_name AS "middleName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,phone,email,national_identifier AS "nationalId",preferred_language AS "preferredLanguage",address,status,created_at AS "createdAt",updated_at AS "updatedAt"`,[dbOrganizationId(req),p.facilityId||null,number,p.firstName,p.middleName||null,p.lastName,p.dateOfBirth||null,p.sex||null,p.phone||null,p.email||null,p.nationalId||null,p.preferredLanguage||null,p.address?JSON.stringify(p.address):null]);
    await dbAudit(client,req,'CREATE','patient',r.rows[0].id,{patientNumber:number}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(e:any){ await client.query('ROLLBACK'); if(e.code==='23505') return reply.code(409).send({error:'Patient number already exists'}); throw e; } finally{client.release();}
});
app.post('/api/patients/:id/contacts',async(req:any,reply)=>{ const c=contact.parse(req.body); if(!pool)return reply.code(201).send(add('patient-contacts',{patientId:req.params.id,...c},req)); const client=await pool.connect(); try{await client.query('BEGIN'); const ok=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[req.params.id,dbOrganizationId(req)]); if(!ok.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});} if(c.isPrimary) await client.query('UPDATE patient_contacts SET is_primary=false WHERE patient_id=$1',[req.params.id]); const r=await client.query(`INSERT INTO patient_contacts(patient_id,type,value,is_primary) VALUES($1,$2,$3,$4) RETURNING id,type,value,is_primary AS "isPrimary"`,[req.params.id,c.type,c.value,c.isPrimary]); await dbAudit(client,req,'CREATE','patient_contact',r.rows[0].id,{patientId:req.params.id}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]); }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()} });
app.post('/api/patients/:id/emergency-contacts',async(req:any,reply)=>{ const c=emergencyContact.parse(req.body); if(!pool)return reply.code(201).send(add('emergency-contacts',{patientId:req.params.id,...c},req)); const client=await pool.connect(); try{await client.query('BEGIN'); const ok=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[req.params.id,dbOrganizationId(req)]); if(!ok.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});} const r=await client.query(`INSERT INTO emergency_contacts(patient_id,name,relationship,phone,address) VALUES($1,$2,$3,$4,$5) RETURNING id,name,relationship,phone,address`,[req.params.id,c.name,c.relationship||null,c.phone||null,c.address||null]); await dbAudit(client,req,'CREATE','emergency_contact',r.rows[0].id,{patientId:req.params.id}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]); }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()} });
app.post('/api/patients/:id/allergies',async(req:any,reply)=>{ const a=allergy.parse(req.body); if(!pool)return reply.code(201).send(add('allergies',{patientId:req.params.id,...a},req)); const client=await pool.connect(); try{await client.query('BEGIN'); const ok=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[req.params.id,dbOrganizationId(req)]); if(!ok.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});} const r=await client.query(`INSERT INTO allergies(patient_id,substance,reaction,severity,status) VALUES($1,$2,$3,$4,$5) RETURNING id,substance,reaction,severity,status`,[req.params.id,a.substance,a.reaction||null,a.severity||null,a.status]); await dbAudit(client,req,'CREATE','allergy',r.rows[0].id,{patientId:req.params.id,substance:a.substance}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]); }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()} });
app.post('/api/appointments',async(req:any,reply)=>{
  const a=appointment.parse(req.body);
  if(!pool) return reply.code(201).send(add('appointments',a,req));
  const client=await pool.connect(); try{ await client.query('BEGIN');
    const pc=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[a.patientId,dbOrganizationId(req)]);
    if(!pc.rowCount){await client.query('ROLLBACK');return reply.code(400).send({error:'Patient not found'});}
    const end=new Date(new Date(a.startAt).getTime()+a.durationMinutes*60000).toISOString();
    const r=await client.query(`INSERT INTO appointments(organization_id,patient_id,provider_user_id,facility_id,start_at,end_at,type,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,organization_id AS "organizationId",patient_id AS "patientId",provider_user_id AS "providerId",facility_id AS "facilityId",start_at AS "startAt",end_at AS "endAt",type,reason,status,created_at AS "createdAt"`,[dbOrganizationId(req),a.patientId,a.providerId||null,a.facilityId||null,a.startAt,end,a.type,a.reason||null,a.status]);
    await dbAudit(client,req,'CREATE','appointment',r.rows[0].id,{patientId:a.patientId}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
});
app.post('/api/encounters',async(req:any,reply)=>{
  const e=encounter.parse(req.body);
  if(!pool) return reply.code(201).send(add('encounters',e,req));
  const client=await pool.connect(); try{await client.query('BEGIN');
    const r=await client.query(`INSERT INTO encounters(organization_id,patient_id,appointment_id,provider_user_id,facility_id,type,status) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM patients WHERE id=$2 AND organization_id=$1) RETURNING id,organization_id AS "organizationId",patient_id AS "patientId",appointment_id AS "appointmentId",provider_user_id AS "providerId",facility_id AS "facilityId",type,status,started_at AS "startedAt"`,[dbOrganizationId(req),e.patientId,e.appointmentId||null,e.providerId||null,e.facilityId||null,e.type,e.status]);
    if(!r.rowCount){await client.query('ROLLBACK');return reply.code(400).send({error:'Patient not found'});}
    await dbAudit(client,req,'CREATE','encounter',r.rows[0].id,{patientId:e.patientId}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
});
app.post('/api/triage',async(req:any,reply)=>{
  const t=triage.parse(req.body);
  if(!pool){const x=add('triage',{...t,status:'completed',completedAt:now()},req);add('queue',{patientId:t.patientId,encounterId:t.encounterId,status:t.acuity==='emergency'?'emergency':'waiting-doctor',priority:t.acuity},req);return reply.code(201).send(x);}
  const client=await pool.connect(); try{await client.query('BEGIN');
    const p=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[t.patientId,dbOrganizationId(req)]); if(!p.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}
    const record={...t,status:'completed',completedAt:now()};
    const tr=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'triage','completed',$2,$3) RETURNING id,created_at AS "createdAt"`,[dbOrganizationId(req),JSON.stringify(record),dbUserId(req)]);
    const vitals:[string,number|undefined,string][]=[['temperature',t.temperature,'Cel'],['heart-rate',t.heartRate,'/min'],['respiratory-rate',t.respiratoryRate,'/min'],['systolic-blood-pressure',t.systolic,'mmHg'],['diastolic-blood-pressure',t.diastolic,'mmHg'],['oxygen-saturation',t.spo2,'%'],['pain-score',t.pain,'/10']];
    for(const [code,value,unit] of vitals) if(value!==undefined) await client.query(`INSERT INTO observations(patient_id,encounter_id,code_system,code,display,value_numeric,unit,performer_user_id) VALUES($1,$2,'LOINC',$3,$4,$5,$6,$7)`,[t.patientId,t.encounterId||null,code,code,value,unit,dbUserId(req)]);
    let q=await client.query('SELECT id FROM queues WHERE organization_id=$1 ORDER BY created_at LIMIT 1',[dbOrganizationId(req)]); if(!q.rowCount) q=await client.query("INSERT INTO queues(organization_id,code,name) VALUES($1,'GENERAL','General Queue') RETURNING id",[dbOrganizationId(req)]);
    const status=t.acuity==='emergency'?'emergency':'waiting-doctor';
    const qe=await client.query('INSERT INTO queue_entries(queue_id,patient_id,priority,status) VALUES($1,$2,$3,$4) RETURNING id',[q.rows[0].id,t.patientId,t.acuity,status]);
    await dbAudit(client,req,'CREATE','triage',tr.rows[0].id,{patientId:t.patientId,acuity:t.acuity}); await client.query('COMMIT'); return reply.code(201).send({id:tr.rows[0].id,...record,queueEntryId:qe.rows[0].id});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});
app.post('/api/orders',async(req:any,reply)=>{
  const o=order.parse(req.body);
  if(!pool){const x=add('orders',{...o,status:'ordered',orderedAt:now()},req);if(o.category==='laboratory')add('laboratory',{orderId:x.id,patientId:o.patientId,status:'ordered',priority:o.priority,code:o.code,description:o.description},req);if(o.category==='imaging')add('imaging',{orderId:x.id,patientId:o.patientId,status:'ordered',priority:o.priority,code:o.code,description:o.description},req);if(o.category==='medication')add('pharmacy',{orderId:x.id,patientId:o.patientId,status:'prescribed',priority:o.priority,medicationCode:o.code,description:o.description},req);if(o.category==='procedure')add('procedures',{orderId:x.id,patientId:o.patientId,status:'ordered',code:o.code,description:o.description},req);return reply.code(201).send(x);}
  const client=await pool.connect();try{await client.query('BEGIN');
    const p=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[o.patientId,dbOrganizationId(req)]);if(!p.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}
    const r=await client.query(`INSERT INTO clinical_orders(patient_id,encounter_id,ordered_by,order_type,priority,status,details) VALUES($1,$2,$3,$4,$5,'ordered',$6) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",order_type AS category,priority,status,details,created_at AS "createdAt"`,[o.patientId,o.encounterId||null,dbUserId(req),o.category,o.priority,JSON.stringify({code:o.code,description:o.description,...(o.details||{})})]);
    const routed=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,$2,'ordered',$3,$4) RETURNING id`,[dbOrganizationId(req),o.category,JSON.stringify({orderId:r.rows[0].id,patientId:o.patientId,encounterId:o.encounterId||null,code:o.code,description:o.description,priority:o.priority,status:'ordered'}),dbUserId(req)]);
    let sampleMeta:any=null; if(o.category==='laboratory'){ let test=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND code=$2 LIMIT 1`,[dbOrganizationId(req),o.code]); if(!test.rowCount)test=await client.query(`INSERT INTO lab_tests(organization_id,code,name,active) VALUES($1,$2,$3,true) RETURNING id`,[dbOrganizationId(req),o.code,o.description||o.code]); const barcode=`CLN-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`; const sample=await client.query(`INSERT INTO lab_samples(order_id,barcode,status) VALUES($1,$2,'ordered') RETURNING id,barcode,status`,[r.rows[0].id,barcode]); sampleMeta=sample.rows[0]; await client.query(`UPDATE module_records SET payload=payload || $1::jsonb WHERE id=$2`,[JSON.stringify({sampleId:sample.rows[0].id,barcode:sample.rows[0].barcode}),routed.rows[0].id]); }
    if(o.category==='laboratory') {
      let test=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND code=$2 LIMIT 1`,[dbOrganizationId(req),o.code]);
      if(!test.rowCount) test=await client.query(`INSERT INTO lab_tests(organization_id,code,name,active) VALUES($1,$2,$3,true) RETURNING id`,[dbOrganizationId(req),o.code,o.description||o.code]);
      const barcode=`CLN-${Date.now()}-${Math.floor(Math.random()*100000)}`;
      const sample=await client.query(`INSERT INTO lab_samples(order_id,barcode,specimen_type,status) VALUES($1,$2,$3,'collected') RETURNING id,barcode`,[r.rows[0].id,barcode,o.details?.specimenType||null]);
      if(o.details?.valueNumeric!==undefined || o.details?.valueText!==undefined) await client.query(`INSERT INTO lab_results(sample_id,test_id,value_numeric,value_text,unit,abnormal_flag,critical,status) VALUES($1,$2,$3,$4,$5,$6,$7,'preliminary')`,[sample.rows[0].id,test.rows[0].id,o.details?.valueNumeric??null,o.details?.valueText??null,o.details?.unit??null,o.details?.abnormalFlag??null,Boolean(o.details?.critical)]);
    }
    await dbAudit(client,req,'CREATE','clinical_order',r.rows[0].id,{category:o.category,code:o.code,routedRecordId:routed.rows[0].id});await queueEvent(client,req,'clinical_order.created',{orderId:r.rows[0].id,category:o.category,patientId:o.patientId});await client.query('COMMIT');return reply.code(201).send(r.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.get('/api/queue',async(req:any)=>{
  if(!pool) return {data:store.queue.filter(x=>x.organizationId===org(req)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))),count:store.queue.length};
  const oid=dbOrganizationId(req);
  const r=await pool.query(`SELECT qe.id, q.code AS "queueCode", q.name AS "queueName", qe.patient_id AS "patientId", qe.appointment_id AS "appointmentId", qe.priority, qe.status, qe.joined_at AS "joinedAt", qe.called_at AS "calledAt", qe.completed_at AS "completedAt" FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 ORDER BY qe.joined_at ASC LIMIT 500`,[oid]);
  return {data:r.rows,count:r.rowCount};
});
app.post('/api/queue',async(req:any,reply)=>{
  const b=z.object({patientId:z.string().uuid(),appointmentId:z.string().uuid().optional(),facilityId:z.string().uuid().optional(),priority:z.enum(['normal','routine','urgent','emergency','stat']).default('normal'),status:z.string().default('waiting')}).parse(req.body);
  if(!pool)return reply.code(201).send(add('queue',b,req));
  const client=await pool.connect(); try{await client.query('BEGIN');
    const patient=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[b.patientId,dbOrganizationId(req)]);
    if(!patient.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}
    let q=await client.query('SELECT id FROM queues WHERE organization_id=$1 AND facility_id IS NOT DISTINCT FROM $2 ORDER BY created_at LIMIT 1',[dbOrganizationId(req),b.facilityId||null]);
    if(!q.rowCount) q=await client.query('INSERT INTO queues(organization_id,facility_id,code,name) VALUES($1,$2,$3,$4) RETURNING id',[dbOrganizationId(req),b.facilityId||null,'GENERAL','General Queue']);
    const dup=await client.query("SELECT id FROM queue_entries WHERE queue_id=$1 AND patient_id=$2 AND status NOT IN ('completed','cancelled','no-show') LIMIT 1",[q.rows[0].id,b.patientId]);
    if(dup.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Patient already has an active queue entry',queueEntryId:dup.rows[0].id});}
    const r=await client.query(`INSERT INTO queue_entries(queue_id,patient_id,appointment_id,priority,status) VALUES($1,$2,$3,$4,$5) RETURNING id,patient_id AS "patientId",appointment_id AS "appointmentId",priority,status,joined_at AS "joinedAt"`,[q.rows[0].id,b.patientId,b.appointmentId||null,b.priority,b.status]);
    await dbAudit(client,req,'CREATE','queue_entry',r.rows[0].id,{patientId:b.patientId}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.get('/api/:module',async(req:any,reply)=>{
  const m=req.params.module as Mod;if(!store[m])return reply.code(404).send({error:'Module not found'});
  if(!pool)return {data:store[m].filter(x=>x.organizationId===org(req)).slice(-500).reverse(),count:store[m].filter(x=>x.organizationId===org(req)).length};
  if(['patients','appointments','encounters','queue'].includes(m)) return reply.code(400).send({error:'Use the resource endpoint for this module'});
  if(m==='inventory'){const r=await pool.query(`SELECT ii.id,ii.sku,ii.name,ii.unit,ii.reorder_level AS "reorderLevel",ii.active,COALESCE(sum(ib.quantity),0) AS quantity,COUNT(ib.id)::int AS "batchCount" FROM inventory_items ii LEFT JOIN inventory_batches ib ON ib.item_id=ii.id WHERE ii.organization_id=$1 GROUP BY ii.id ORDER BY ii.name LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='suppliers'){const r=await pool.query(`SELECT id,name,contact FROM suppliers WHERE organization_id=$1 ORDER BY name LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows.map((x:any)=>({id:x.id,name:x.name,...(x.contact||{})})),count:r.rowCount};}
  if(m==='insurance'){const r=await pool.query(`SELECT ip.id,ip.patient_id AS "patientId",ip.policy_number AS "policyNumber",ip.status,pr.name AS provider FROM insurance_policies ip JOIN insurance_providers pr ON pr.id=ip.provider_id JOIN patients p ON p.id=ip.patient_id WHERE p.organization_id=$1 ORDER BY ip.id DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='claims'){const r=await pool.query(`SELECT c.id,c.status,c.external_reference AS "externalReference",c.policy_id AS "policyId",c.invoice_id AS "invoiceId",p.patient_id AS "patientId" FROM claims c LEFT JOIN insurance_policies p ON p.id=c.policy_id JOIN patients pt ON pt.id=p.patient_id WHERE pt.organization_id=$1 ORDER BY c.id DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='notifications'){const r=await pool.query(`SELECT id,patient_id AS "patientId",channel,template,status,payload,scheduled_at AS "scheduledAt",sent_at AS "sentAt",created_at AS "createdAt" FROM notifications WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='documents'){const r=await pool.query(`SELECT id,patient_id AS "patientId",encounter_id AS "encounterId",document_type AS "documentType",storage_ref AS "storageRef",mime_type AS "mimeType",created_by AS "createdBy",created_at AS "createdAt" FROM documents WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='laboratory'){const r=await pool.query(`SELECT lr.id,co.patient_id AS "patientId",co.id AS "orderId",ls.id AS "sampleId",ls.barcode,lt.code,lt.name,lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status,lr.verified_at AS "verifiedAt" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 ORDER BY lr.verified_at DESC NULLS LAST,lr.id DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='clinical-notes'){const r=await pool.query(`SELECT n.id,e.patient_id AS "patientId",n.encounter_id AS "encounterId",n.note_type AS "noteType",n.subjective,n.objective,n.assessment,n.plan,n.signed_at AS "signedAt",n.version FROM clinical_notes n JOIN encounters e ON e.id=n.encounter_id WHERE e.organization_id=$1 ORDER BY n.id DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='diagnoses'){const r=await pool.query(`SELECT d.id,d.patient_id AS "patientId",d.encounter_id AS "encounterId",d.code_system AS "codeSystem",d.code,d.display AS description,d.diagnosis_type AS "diagnosisType",d.status FROM diagnoses d JOIN patients p ON p.id=d.patient_id WHERE p.organization_id=$1 ORDER BY d.id DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='procedures'){const r=await pool.query(`SELECT p.id,p.patient_id AS "patientId",p.encounter_id AS "encounterId",p.code,p.display AS description,p.performed_at AS "performedAt" FROM procedures p JOIN patients x ON x.id=p.patient_id WHERE x.organization_id=$1 ORDER BY p.id DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='care-plans'){const r=await pool.query(`SELECT c.id,c.patient_id AS "patientId",c.encounter_id AS "encounterId",c.title AS problem,c.status,c.goals FROM care_plans c JOIN patients p ON p.id=c.patient_id WHERE p.organization_id=$1 ORDER BY c.id DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='referrals'){const r=await pool.query(`SELECT r.id,r.patient_id AS "patientId",r.encounter_id AS "encounterId",r.destination,r.reason,r.status,r.created_at AS "createdAt" FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 ORDER BY r.created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='pharmacy'){const r=await pool.query(`SELECT mo.id,mo.patient_id AS "patientId",mo.encounter_id AS "encounterId",mo.dose,mo.frequency,mo.route,mo.duration,mo.quantity,mo.status,m.code AS "medicationCode",m.name AS "medicationName",(SELECT ib.id FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ii.organization_id=$1 AND (ii.sku=m.code OR lower(ii.name)=lower(m.name)) AND ib.quantity>0 ORDER BY ib.expiry_date NULLS LAST,ib.id LIMIT 1) AS "inventoryBatchId" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id JOIN patients p ON p.id=mo.patient_id WHERE p.organization_id=$1 ORDER BY mo.id DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='billing'){const r=await pool.query(`SELECT i.id,i.patient_id AS "patientId",i.encounter_id AS "encounterId",i.status,i.currency,i.total,i.created_at AS "createdAt",COALESCE((SELECT sum(amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='completed'),0) AS "paidAmount" FROM invoices i WHERE i.organization_id=$1 ORDER BY i.created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  if(m==='payments'){const r=await pool.query(`SELECT p.id,p.invoice_id AS "invoiceId",i.patient_id AS "patientId",p.method,p.provider_reference AS "providerReference",p.amount,p.status,p.paid_at AS "paidAt" FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.organization_id=$1 ORDER BY p.paid_at DESC NULLS LAST LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};}
  const params:any[]=[dbOrganizationId(req),m]; let where='organization_id=$1 AND module=$2';
  if(req.query?.status){params.push(String(req.query.status));where+=' AND status=$3';}
  const r=await pool.query(`SELECT id,organization_id AS "organizationId",module,status,payload,created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE ${where} ORDER BY created_at DESC LIMIT 500`,params);
  return {data:r.rows.map((x:any)=>({id:x.id,organizationId:x.organizationId,module:x.module,status:x.status,...x.payload,createdBy:x.createdBy,createdAt:x.createdAt,updatedAt:x.updatedAt})),count:r.rowCount};
});
app.post('/api/:module',async(req:any,reply)=>{const m=req.params.module as Mod;if(!store[m])throw Object.assign(new Error('Not found'),{statusCode:404});if(['patients','appointments','encounters','triage','orders','queue'].includes(m))throw Object.assign(new Error('Use the validated endpoint for this resource'),{statusCode:400});const body=generic.parse(req.body);
if(pool && m==='clinical-notes'){const client=await pool.connect();try{await client.query('BEGIN');const e=await client.query('SELECT id,patient_id AS "patientId" FROM encounters WHERE id=$1 AND organization_id=$2',[body.encounterId,dbOrganizationId(req)]);if(!e.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Encounter not found'});}const r=await client.query(`INSERT INTO clinical_notes(encounter_id,note_type,subjective,objective,assessment,plan) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,encounter_id AS "encounterId",note_type AS "noteType",subjective,objective,assessment,plan,signed_at AS "signedAt",version`,[body.encounterId,body.noteType||'SOAP',body.subjective||null,body.objective||null,body.assessment||null,body.plan||null]);await dbAudit(client,req,'CREATE','clinical_note',r.rows[0].id,{patientId:e.rows[0].patientId});await client.query('COMMIT');return reply.code(201).send({...r.rows[0],patientId:e.rows[0].patientId,status:'draft'});}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
if(pool && m==='diagnoses'){const r=await pool.query(`INSERT INTO diagnoses(patient_id,encounter_id,code_system,code,display,diagnosis_type) SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$7) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",code_system AS "codeSystem",code,display,diagnosis_type AS "diagnosisType",status`,[body.patientId,body.encounterId||null,body.codeSystem||'ICD-10',body.code||null,body.description||body.display||'Unspecified',body.diagnosisType||'working',dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Patient not found'});return reply.code(201).send(r.rows[0]);}
if(pool && m==='procedures'){const r=await pool.query(`INSERT INTO procedures(patient_id,encounter_id,code_system,code,display,performed_at,performer_user_id) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$8) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",code_system AS "codeSystem",code,display,performed_at AS "performedAt"`,[body.patientId,body.encounterId||null,body.codeSystem||null,body.code||null,body.description||body.procedure||'Procedure',body.performedAt||null,dbUserId(req),dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Patient not found'});return reply.code(201).send(r.rows[0]);}
if(pool && m==='care-plans'){const r=await pool.query(`INSERT INTO care_plans(patient_id,encounter_id,title,status,goals) SELECT $1,$2,$3,$4,$5::jsonb WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$6) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",title,status,goals`,[body.patientId,body.encounterId||null,body.problem||body.title||'Care plan',body.status||'active',JSON.stringify(body.goals||[body.goal].filter(Boolean)),dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Patient not found'});return reply.code(201).send(r.rows[0]);}
if(pool && m==='referrals'){const r=await pool.query(`INSERT INTO referrals(patient_id,encounter_id,destination,reason,status) SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$6) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",destination,reason,status,created_at AS "createdAt"`,[body.patientId,body.encounterId||null,body.destination||null,body.reason||'Referral',body.status||'draft',dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Patient not found'});return reply.code(201).send(r.rows[0]);}
if(pool && m==='inventory'){const b=body;const client=await pool.connect();try{await client.query('BEGIN');const item=await client.query(`INSERT INTO inventory_items(organization_id,sku,name,unit,reorder_level) VALUES($1,$2,$3,$4,$5) RETURNING id,sku,name,unit,reorder_level AS "reorderLevel",active`,[dbOrganizationId(req),b.sku||null,b.name||'Inventory item',b.unit||null,Number(b.reorderLevel||0)]);if(b.quantity!==undefined){await client.query(`INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity,location) VALUES($1,$2,$3,$4,$5)`,[item.rows[0].id,b.batchNumber||null,b.expiryDate||null,Number(b.quantity||0),b.location||null]);}await dbAudit(client,req,'CREATE','inventory_item',item.rows[0].id,{});await client.query('COMMIT');return reply.code(201).send({...item.rows[0],quantity:Number(b.quantity||0)});}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  if(pool && m==='insurance'){const b=body;const client=await pool.connect();try{await client.query('BEGIN');let pr=await client.query(`SELECT id FROM insurance_providers WHERE organization_id=$1 AND lower(name)=lower($2) LIMIT 1`,[dbOrganizationId(req),b.provider||'Insurance Provider']);if(!pr.rowCount)pr=await client.query(`INSERT INTO insurance_providers(organization_id,name) VALUES($1,$2) RETURNING id`,[dbOrganizationId(req),b.provider||'Insurance Provider']);const r=await client.query(`INSERT INTO insurance_policies(patient_id,provider_id,policy_number,status,coverage) SELECT $1,$2,$3,$4,$5::jsonb WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$6) RETURNING id,patient_id AS "patientId",policy_number AS "policyNumber",status`,[b.patientId,pr.rows[0].id,b.policyNumber||'',b.status||'active',JSON.stringify(b.coverage||{}),dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}await dbAudit(client,req,'CREATE','insurance_policy',r.rows[0].id,{patientId:b.patientId});await client.query('COMMIT');return reply.code(201).send({...r.rows[0],provider:b.provider||'Insurance Provider'});}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  if(pool && m==='claims'){const r=await pool.query(`INSERT INTO claims(policy_id,invoice_id,status,external_reference) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM insurance_policies ip JOIN patients p ON p.id=ip.patient_id WHERE ip.id=$1 AND p.organization_id=$5) RETURNING id,policy_id AS "policyId",invoice_id AS "invoiceId",status,external_reference AS "externalReference"`,[body.policyId||null,body.invoiceId||null,body.status||'draft',body.claimNumber||body.externalReference||null,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Insurance policy not found'});return reply.code(201).send(r.rows[0]);}
  if(pool && m==='billing'){const client=await pool.connect();try{await client.query('BEGIN');const total=Number(body.total||body.amount||0);const inv=await client.query(`INSERT INTO invoices(organization_id,patient_id,encounter_id,status,currency,total) VALUES($1,$2,$3,'open',$4,$5) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",status,currency,total,created_at AS "createdAt"`,[dbOrganizationId(req),body.patientId||null,body.encounterId||null,body.currency||'UGX',total]);if(body.description){await client.query(`INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,total) VALUES($1,$2,1,$3,$3)`,[inv.rows[0].id,body.description,total]);}await dbAudit(client,req,'CREATE','invoice',inv.rows[0].id,{total});await client.query('COMMIT');return reply.code(201).send({...inv.rows[0],description:body.description||null});}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
if(pool && m==='pharmacy'){const client=await pool.connect();try{await client.query('BEGIN');let med=await client.query(`SELECT id FROM medications WHERE organization_id=$1 AND (code=$2 OR lower(name)=lower($3)) LIMIT 1`,[dbOrganizationId(req),body.medicationCode||null,body.medicationName||'Medication']);if(!med.rowCount)med=await client.query(`INSERT INTO medications(organization_id,code,name,active) VALUES($1,$2,$3,true) RETURNING id`,[dbOrganizationId(req),body.medicationCode||null,body.medicationName||'Medication']);const r=await client.query(`INSERT INTO medication_orders(patient_id,encounter_id,medication_id,dose,frequency,route,duration,quantity,status,prescribed_by) SELECT $1,$2,$3,$4,$5,$6,$7,$8,'active',$9 WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$10) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",medication_id AS "medicationId",dose,frequency,route,duration,quantity,status`,[body.patientId,body.encounterId||null,med.rows[0].id,body.dose||null,body.frequency||null,body.route||null,body.duration||null,Number(body.quantity||1),dbUserId(req),dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}await dbAudit(client,req,'CREATE','medication_order',r.rows[0].id,{patientId:body.patientId});await client.query('COMMIT');return reply.code(201).send({...r.rows[0],medicationCode:body.medicationCode||null,medicationName:body.medicationName||null});}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
if(!pool)return reply.code(201).send(add(m,body,req));const r=await pool.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,organization_id AS "organizationId",module,status,payload,created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt"`,[dbOrganizationId(req),m,body.status||'active',JSON.stringify(body),dbUserId(req)]);await pool.query('INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[dbOrganizationId(req),dbUserId(req),'CREATE',m,r.rows[0].id,JSON.stringify({module:m})]);return reply.code(201).send({id:r.rows[0].id,organizationId:r.rows[0].organizationId,module:m,status:r.rows[0].status,...r.rows[0].payload,createdBy:r.rows[0].createdBy,createdAt:r.rows[0].createdAt,updatedAt:r.rows[0].updatedAt});});
app.patch('/api/:module/:id',async(req:any,reply)=>{const m=req.params.module as Mod;if(!store[m])return reply.code(404).send({error:'Module not found'});const body=generic.parse(req.body);if(!pool){const row=patch(m,req.params.id,body,req);if(!row)return reply.code(404).send({error:'Not found'});return row;}const r=await pool.query(`UPDATE module_records SET payload=payload || $1::jsonb,status=COALESCE($2,status),updated_at=now() WHERE id=$3 AND organization_id=$4 AND module=$5 RETURNING id,organization_id AS "organizationId",module,status,payload,created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt"`,[JSON.stringify(body),body.status||null,req.params.id,dbOrganizationId(req),m]);if(!r.rowCount)return reply.code(404).send({error:'Not found'});return {id:r.rows[0].id,organizationId:r.rows[0].organizationId,module:m,status:r.rows[0].status,...r.rows[0].payload,createdBy:r.rows[0].createdBy,createdAt:r.rows[0].createdAt,updatedAt:r.rows[0].updatedAt};});
app.delete('/api/:module/:id',async(req:any,reply)=>{const m=req.params.module as Mod;if(!store[m])return reply.code(404).send({error:'Module not found'});if(!pool){if(!remove(m,req.params.id,req))return reply.code(404).send({error:'Not found'});return {ok:true};}const r=await pool.query('DELETE FROM module_records WHERE id=$1 AND organization_id=$2 AND module=$3 RETURNING id',[req.params.id,dbOrganizationId(req),m]);if(!r.rowCount)return reply.code(404).send({error:'Not found'});await pool.query('INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[dbOrganizationId(req),dbUserId(req),'DELETE',m,req.params.id,JSON.stringify({module:m})]);return {ok:true};});

app.post('/api/workflows/:name',async(req:any,reply)=>{
  const b=(req.body||{}) as Row; const name=String(req.params.name); const oid=dbOrganizationId(req);
  if(!pool){
    let results:Row[]=[];
    switch(name){
      case'checkin':{const a=store.appointments.find(x=>x.id===b.appointmentId&&x.organizationId===org(req));if(!a)throw Object.assign(new Error('Appointment not found'),{statusCode:404});patch('appointments',a.id,{status:'arrived',arrivedAt:now()},req);results=[add('registration',{...b,status:'checked-in',checkedInAt:now()},req),add('queue',{patientId:b.patientId,appointmentId:b.appointmentId,status:'waiting-triage',priority:b.priority||'normal'},req)];break;}
      case'triage':results=[add('triage',{...b,status:'completed',completedAt:now()},req),add('queue',{patientId:b.patientId,status:b.acuity==='emergency'?'emergency':'waiting-doctor',priority:b.acuity||'routine'},req)];break;
      case'lab_result':results=[add('laboratory',{...b,status:'verified',verifiedAt:now()},req),add('notifications',{patientId:b.patientId,channel:b.channel||'in-app',template:b.critical?'critical-lab':'result-ready',status:'queued'},req),add('tasks',{patientId:b.patientId,type:b.critical?'critical-result-review':'result-review',status:'open',priority:b.critical?'critical':'normal'},req)];break;
      case'dispense':results=[add('pharmacy',{...b,status:'dispensed',dispensedAt:now()},req),add('inventory',{itemId:b.itemId,quantityDelta:-(b.quantity||1),movement:'dispense'},req),add('notifications',{patientId:b.patientId,channel:'in-app',template:'prescription-ready',status:'queued'},req)];break;
      case'discharge':results=[add('inpatient',{...b,status:'discharged',dischargedAt:now()},req),add('follow-up',{patientId:b.patientId,status:'due',dueAt:b.followUpDate||null},req),add('tasks',{patientId:b.patientId,type:'follow-up-booking',status:'open'},req)];break;
      case'payment':results=[add('payments',{...b,status:'completed',paidAt:now()},req),add('notifications',{patientId:b.patientId,channel:b.channel||'in-app',template:'payment-receipt',status:'queued'},req)];break;
      case'referral':results=[add('referrals',{...b,status:'sent',sentAt:now()},req),add('tasks',{patientId:b.patientId,type:'referral-tracking',status:'open'},req)];break;
      default:throw Object.assign(new Error('Workflow not implemented'),{statusCode:404});
    } return reply.code(201).send({workflow:name,results,eventId:randomUUID()});
  }
  const client=await pool.connect();
  try{await client.query('BEGIN'); let result:any;
    if(name==='checkin'){
      const a=await client.query(`UPDATE appointments SET status='arrived' WHERE id=$1 AND organization_id=$2 RETURNING id,patient_id AS "patientId",facility_id AS "facilityId"`,[b.appointmentId,oid]); if(!a.rowCount)return reply.code(404).send({error:'Appointment not found'});
      let q=await client.query(`SELECT id FROM queues WHERE organization_id=$1 AND code='OUTPATIENT' LIMIT 1`,[oid]); if(!q.rowCount)q=await client.query(`INSERT INTO queues(organization_id,facility_id,code,name) VALUES($1,$2,'OUTPATIENT','Outpatient Queue') RETURNING id`,[oid,a.rows[0].facilityId||null]);
      const qe=await client.query(`INSERT INTO queue_entries(queue_id,patient_id,appointment_id,priority,status) VALUES($1,$2,$3,$4,'waiting-triage') RETURNING id,patient_id AS "patientId",appointment_id AS "appointmentId",priority,status`,[q.rows[0].id,a.rows[0].patientId,b.appointmentId,b.priority||'normal']);
      result={appointment:a.rows[0],queue:qe.rows[0]};
      await dbAudit(client,req,'CHECK_IN','appointment',b.appointmentId,{queueEntryId:qe.rows[0].id});
      await client.query(`INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'appointment.checked_in','appointment',$2,$3)`,[oid,b.appointmentId,JSON.stringify(result)]);
    } else if(name==='triage'){
      const p=await client.query(`SELECT id FROM patients WHERE id=$1 AND organization_id=$2`,[b.patientId,oid]);if(!p.rowCount)return reply.code(404).send({error:'Patient not found'});
      const tr=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'triage','completed',$2,$3) RETURNING id,payload,status,created_at AS "createdAt"`,[oid,JSON.stringify({...b,status:'completed',completedAt:now()}),dbUserId(req)]);
      let q=await client.query(`SELECT id FROM queues WHERE organization_id=$1 ORDER BY created_at LIMIT 1`,[oid]);if(!q.rowCount)q=await client.query(`INSERT INTO queues(organization_id,code,name) VALUES($1,'GENERAL','General Queue') RETURNING id`,[oid]);
      const qe=await client.query(`INSERT INTO queue_entries(queue_id,patient_id,priority,status) VALUES($1,$2,$3,$4) RETURNING id`,[q.rows[0].id,b.patientId,b.acuity||'routine',b.acuity==='emergency'?'emergency':'waiting-doctor']);result={triage:{id:tr.rows[0].id,...b,status:'completed'},queueEntryId:qe.rows[0].id};
      await dbAudit(client,req,'TRIAGE_COMPLETE','triage',tr.rows[0].id,{patientId:b.patientId,acuity:b.acuity||'routine'});
    } else if(name==='lab_result'){
      const sample=await client.query(`SELECT ls.id,co.patient_id AS "patientId" FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE ls.id=$1 AND p.organization_id=$2 FOR UPDATE`,[b.sampleId,oid]);
      if(!sample.rowCount)return reply.code(404).send({error:'Lab sample not found'});
      let test=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND (code=$2 OR lower(name)=lower($3)) LIMIT 1`,[oid,b.testCode||null,b.testName||'Lab Test']);if(!test.rowCount)test=await client.query(`INSERT INTO lab_tests(organization_id,code,name,unit,active) VALUES($1,$2,$3,$4,true) RETURNING id`,[oid,b.testCode||null,b.testName||'Lab Test',b.unit||null]);
      const lr=await client.query(`INSERT INTO lab_results(sample_id,test_id,value_numeric,value_text,unit,abnormal_flag,critical,status,verified_by,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,'preliminary',NULL,NULL) RETURNING id,sample_id AS "sampleId",value_numeric AS "valueNumeric",value_text AS "valueText",unit,abnormal_flag AS "abnormalFlag",critical,status,verified_at AS "verifiedAt"`,[b.sampleId,test.rows[0].id,b.valueNumeric??null,b.valueText??null,b.unit||null,b.abnormalFlag||null,Boolean(b.critical),dbUserId(req)]);
      await client.query(`UPDATE lab_samples SET status='processed',processed_at=now() WHERE id=$1`,[b.sampleId]);
      await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3)`,[oid,JSON.stringify({patientId:sample.rows[0].patientId,type:Boolean(b.critical)?'critical-result-review':'result-review',status:'open',priority:Boolean(b.critical)?'critical':'normal',referenceId:lr.rows[0].id}),dbUserId(req)]);
      await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app',$3,'queued',$4)`,[oid,sample.rows[0].patientId,Boolean(b.critical)?'critical-lab':'result-ready',JSON.stringify({labResultId:lr.rows[0].id})]);
      result=lr.rows[0];
    } else if(name==='dispense'){
      const mo=await client.query(`SELECT mo.id,mo.patient_id AS "patientId",mo.quantity,mo.status FROM medication_orders mo JOIN patients p ON p.id=mo.patient_id WHERE mo.id=$1 AND p.organization_id=$2 FOR UPDATE`,[b.medicationOrderId,oid]);if(!mo.rowCount)return reply.code(404).send({error:'Medication order not found'});if(mo.rows[0].status!=='active')return reply.code(409).send({error:'Medication order is not active'});
      const qty=Number(b.quantity||mo.rows[0].quantity||1);if(qty<=0)return reply.code(400).send({error:'Quantity must be positive'});
      if(b.batchId){const stock=await client.query(`SELECT id,quantity FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ib.id=$1 AND ii.organization_id=$2 FOR UPDATE`,[b.batchId,oid]);if(!stock.rowCount)return reply.code(404).send({error:'Inventory batch not found'});if(Number(stock.rows[0].quantity)<qty)return reply.code(409).send({error:'Insufficient stock',available:stock.rows[0].quantity});await client.query(`UPDATE inventory_batches SET quantity=quantity-$1 WHERE id=$2`,[qty,b.batchId]);await client.query(`INSERT INTO stock_movements(item_id,batch_id,movement_type,quantity,reference_type,reference_id,created_by) SELECT item_id,$1,'dispense',$2,'medication_order',$3,$4 FROM inventory_batches WHERE id=$1`,[b.batchId,qty,b.medicationOrderId,dbUserId(req)]);}
      const d=await client.query(`INSERT INTO dispensations(medication_order_id,quantity,batch,expiry_date,dispensed_by) VALUES($1,$2,$3,$4,$5) RETURNING id,medication_order_id AS "medicationOrderId",quantity,batch,expiry_date AS "expiryDate",dispensed_at AS "dispensedAt"`,[b.medicationOrderId,qty,b.batch||null,b.expiryDate||null,dbUserId(req)]);await client.query(`UPDATE medication_orders SET status='dispensed' WHERE id=$1`,[b.medicationOrderId]);result=d.rows[0];await dbAudit(client,req,'DISPENSE','medication_order',b.medicationOrderId,{quantity:qty,batchId:b.batchId||null});
    } else if(name==='discharge'){
      const e=await client.query(`UPDATE encounters SET status='discharged',ended_at=COALESCE(ended_at,now()) WHERE id=$1 AND organization_id=$2 RETURNING id,patient_id AS "patientId",status,ended_at AS "endedAt"`,[b.encounterId,oid]);if(!e.rowCount)return reply.code(404).send({error:'Encounter not found'});
      const f=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'follow-up','due',$2,$3) RETURNING id,payload,status`,[oid,JSON.stringify({patientId:e.rows[0].patientId,encounterId:b.encounterId,dueAt:b.followUpDate||null,reason:b.followUpReason||'Post-discharge follow-up'}),dbUserId(req)]);
      const t=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3) RETURNING id,payload,status`,[oid,JSON.stringify({patientId:e.rows[0].patientId,type:'follow-up-booking',status:'open',priority:'normal',referenceId:f.rows[0].id}),dbUserId(req)]);result={encounter:e.rows[0],followUp:{id:f.rows[0].id,...f.rows[0].payload},task:{id:t.rows[0].id,...t.rows[0].payload}};await dbAudit(client,req,'DISCHARGE','encounter',b.encounterId,{followUpId:f.rows[0].id});
    } else if(name==='payment'){
      const inv=await client.query(`SELECT id,patient_id AS "patientId",total,status FROM invoices WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[b.invoiceId,oid]);if(!inv.rowCount)return reply.code(404).send({error:'Invoice not found'});const paid=await client.query(`SELECT COALESCE(sum(amount),0)::numeric total FROM payments WHERE invoice_id=$1 AND status='completed'`,[b.invoiceId]);const amount=Number(b.amount||Number(inv.rows[0].total)-Number(paid.rows[0].total));if(amount<=0)return reply.code(400).send({error:'Payment amount must be positive'});const outstanding=Number(inv.rows[0].total)-Number(paid.rows[0].total);if(amount>outstanding+0.0001)return reply.code(400).send({error:'Payment exceeds outstanding balance',outstanding});const pay=await client.query(`INSERT INTO payments(invoice_id,method,provider_reference,amount,status,paid_at) VALUES($1,$2,$3,$4,'completed',now()) RETURNING id,invoice_id AS "invoiceId",method,provider_reference AS "providerReference",amount,status,paid_at AS "paidAt"`,[b.invoiceId,b.method||'cash',b.providerReference||null,amount]);const next=amount+Number(paid.rows[0].total)>=Number(inv.rows[0].total)?'paid':'partially-paid';await client.query(`UPDATE invoices SET status=$1 WHERE id=$2`,[next,b.invoiceId]);result=pay.rows[0];await dbAudit(client,req,'PAY','invoice',b.invoiceId,{paymentId:pay.rows[0].id,amount});
    } else if(name==='referral'){
      const r=await client.query(`INSERT INTO referrals(patient_id,encounter_id,destination,reason,status) SELECT $1,$2,$3,$4,'sent' WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$5) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",destination,reason,status,created_at AS "createdAt"`,[b.patientId,b.encounterId||null,b.destination||null,b.reason||'Referral',oid]);if(!r.rowCount)return reply.code(404).send({error:'Patient not found'});const t=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3) RETURNING id`,[oid,JSON.stringify({patientId:b.patientId,type:'referral-tracking',status:'open',priority:'normal',referenceId:r.rows[0].id}),dbUserId(req)]);result={referral:r.rows[0],taskId:t.rows[0].id};await dbAudit(client,req,'REFERRAL_SENT','referral',r.rows[0].id,{patientId:b.patientId});
    } else throw Object.assign(new Error('Workflow not implemented'),{statusCode:404});
    await client.query('COMMIT'); return reply.code(201).send({workflow:name,result});
  }catch(e:any){await client.query('ROLLBACK');throw e}finally{client.release()}
});

// --- Production-oriented workflow helpers ---
app.get('/api/patients/:id/360',async(req:any,reply)=>{
  if(!pool) { const p=store.patients.find(x=>x.id===req.params.id&&x.organizationId===org(req)); if(!p)return reply.code(404).send({error:'Patient not found'}); const related=(m:Mod)=>store[m].filter(x=>x.patientId===p.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))); return {patient:p,contacts:store['patient-contacts'].filter(x=>x.patientId===p.id),emergencyContacts:store['emergency-contacts'].filter(x=>x.patientId===p.id),allergies:store.allergies.filter(x=>x.patientId===p.id),timeline:[...related('encounters'),...related('orders'),...related('triage'),...related('laboratory'),...related('pharmacy'),...related('billing'),...related('payments'),...related('referrals'),...related('follow-up')].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),alerts:store.notifications.filter(x=>x.patientId===p.id&&x.status!=='resolved')}; }
  const patientQ=await pool.query(`SELECT p.id,p.organization_id AS "organizationId",p.facility_id AS "facilityId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.middle_name AS "middleName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.phone,p.email,p.address,p.national_identifier AS "nationalId",p.preferred_language AS "preferredLanguage",p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM patients p WHERE p.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]);
  if(!patientQ.rowCount)return reply.code(404).send({error:'Patient not found'}); const id=req.params.id;
  const [contacts,emergency,allergies,appointments,encounters,orders,diagnoses,observations,notes,notifications]=await Promise.all([
    pool.query(`SELECT id,type,value,is_primary AS "isPrimary" FROM patient_contacts WHERE patient_id=$1 ORDER BY is_primary DESC,id`,[id]),
    pool.query(`SELECT id,name,relationship,phone,address FROM emergency_contacts WHERE patient_id=$1 ORDER BY id`,[id]),
    pool.query(`SELECT id,substance,reaction,severity,status FROM allergies WHERE patient_id=$1 ORDER BY id DESC`,[id]),
    pool.query(`SELECT id,patient_id AS "patientId",provider_user_id AS "providerId",facility_id AS "facilityId",start_at AS "startAt",end_at AS "endAt",type,status,reason,created_at AS "createdAt" FROM appointments WHERE patient_id=$1 AND organization_id=$2 ORDER BY start_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,appointment_id AS "appointmentId",provider_user_id AS "providerId",facility_id AS "facilityId",type,status,started_at AS "startedAt",ended_at AS "endedAt" FROM encounters WHERE patient_id=$1 AND organization_id=$2 ORDER BY started_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,encounter_id AS "encounterId",order_type AS "category",priority,status,details,created_at AS "createdAt" FROM clinical_orders WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 100`,[id]),
    pool.query(`SELECT id,encounter_id AS "encounterId",code_system AS "codeSystem",code,display,diagnosis_type AS "diagnosisType",status FROM diagnoses WHERE patient_id=$1 ORDER BY id DESC LIMIT 100`,[id]),
    pool.query(`SELECT id,encounter_id AS "encounterId",code_system AS "codeSystem",code,display,value_numeric AS "valueNumeric",value_text AS "valueText",unit,observed_at AS "observedAt" FROM observations WHERE patient_id=$1 ORDER BY observed_at DESC LIMIT 100`,[id]),
    pool.query(`SELECT n.id,n.encounter_id AS "encounterId",n.note_type AS "noteType",n.subjective,n.objective,n.assessment,n.plan,n.signed_at AS "signedAt",n.version FROM clinical_notes n JOIN encounters e ON e.id=n.encounter_id WHERE e.patient_id=$1 AND e.organization_id=$2 ORDER BY n.id DESC LIMIT 100`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,channel,template,status,payload,scheduled_at AS "scheduledAt",sent_at AS "sentAt" FROM notifications WHERE patient_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 50`,[id,dbOrganizationId(req)])
  ]);
  return {patient:patientQ.rows[0],contacts:contacts.rows,emergencyContacts:emergency.rows,allergies:allergies.rows,appointments:appointments.rows,encounters:encounters.rows,orders:orders.rows,diagnoses:diagnoses.rows,observations:observations.rows,clinicalNotes:notes.rows,notifications:notifications.rows};
});
app.post('/api/queue/:id/transition',async(req:any,reply)=>{const next=String(req.body?.status||'');const allowed=['waiting','called','in-service','completed','cancelled','no-show','waiting-triage','waiting-doctor','emergency'];if(!allowed.includes(next))return reply.code(400).send({error:'Invalid queue status'});if(!pool){const q=store.queue.find(x=>x.id===req.params.id&&x.organizationId===org(req));if(!q)return reply.code(404).send({error:'Queue entry not found'});const from=q.status;const updated=patch('queue',q.id,{status:next,calledAt:next==='called'?now():q.calledAt,completedAt:next==='completed'?now():q.completedAt},req);events.push({id:randomUUID(),type:'queue.transitioned',from,to:next,resourceId:q.id,at:now()});persist();return updated;}const r=await pool.query(`UPDATE queue_entries qe SET status=$1,called_at=CASE WHEN $1='called' THEN now() ELSE qe.called_at END,completed_at=CASE WHEN $1='completed' THEN now() ELSE qe.completed_at END FROM queues q WHERE qe.id=$2 AND qe.queue_id=q.id AND q.organization_id=$3 RETURNING qe.id,qe.patient_id AS "patientId",qe.status,qe.priority,qe.joined_at AS "joinedAt",qe.called_at AS "calledAt",qe.completed_at AS "completedAt"`,[next,req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Queue entry not found'});await pool.query('INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[dbOrganizationId(req),dbUserId(req),'TRANSITION','queue_entry',req.params.id,JSON.stringify({status:next})]);return r.rows[0];});
app.post('/api/pharmacy/:id/dispense',async(req:any,reply)=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const o=await client.query(`SELECT mo.id,mo.patient_id AS "patientId",mo.quantity,mo.status,m.name AS "medicationName",m.code AS "medicationCode" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id WHERE mo.id=$1 AND EXISTS(SELECT 1 FROM patients p WHERE p.id=mo.patient_id AND p.organization_id=$2) FOR UPDATE`,[req.params.id,dbOrganizationId(req)]);if(!o.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Pharmacy order not found'});}if(o.rows[0].status!=='active'){await client.query('ROLLBACK');return reply.code(409).send({error:'Medication order is not active'});}const qty=Number(req.body?.quantity||o.rows[0].quantity||1);if(qty<=0){await client.query('ROLLBACK');return reply.code(400).send({error:'Quantity must be positive'});}const d=await client.query(`INSERT INTO dispensations(medication_order_id,quantity,batch,expiry_date,dispensed_by) VALUES($1,$2,$3,$4,$5) RETURNING id,medication_order_id AS "medicationOrderId",quantity,batch,expiry_date AS "expiryDate",dispensed_at AS "dispensedAt"`,[req.params.id,qty,req.body?.batch||null,req.body?.expiryDate||null,dbUserId(req)]);await client.query(`UPDATE medication_orders SET status='dispensed' WHERE id=$1`,[req.params.id]);await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','prescription-ready','queued',$3)`,[dbOrganizationId(req),o.rows[0].patientId,JSON.stringify({medicationOrderId:req.params.id})]);await dbAudit(client,req,'DISPENSE','medication_order',req.params.id,{quantity:qty});await client.query('COMMIT');return {...o.rows[0],status:'dispensed',dispensation:d.rows[0]};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  const x=store.pharmacy.find(v=>v.id===req.params.id);if(!x)throw Object.assign(new Error('Pharmacy order not found'),{statusCode:404});const qty=Number(req.body?.quantity||1);if(qty<=0)throw Object.assign(new Error('Quantity must be positive'),{statusCode:400});patch('pharmacy',x.id,{status:'dispensed',quantity:qty,dispensedAt:now(),dispensedBy:actor(req)},req);add('inventory',{itemId:req.body?.itemId||x.medicationCode,quantityDelta:-qty,movement:'dispense',referenceId:x.id},req);add('notifications',{patientId:x.patientId,channel:'in-app',template:'prescription-ready',status:'queued'},req);return store.pharmacy.find(v=>v.id===x.id)});
app.post('/api/billing/:id/pay',async(req:any,reply)=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const inv=await client.query(`SELECT id,patient_id AS "patientId",total,status,currency FROM invoices WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[req.params.id,dbOrganizationId(req)]);if(!inv.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Invoice not found'});}const amount=Number(req.body?.amount||inv.rows[0].total||0);if(amount<=0){await client.query('ROLLBACK');return reply.code(400).send({error:'Payment amount must be positive'});}const paid=await client.query(`SELECT COALESCE(SUM(amount),0)::numeric total FROM payments WHERE invoice_id=$1 AND status='completed'`,[req.params.id]);const outstanding=Number(inv.rows[0].total)-Number(paid.rows[0].total);if(amount>outstanding+0.0001){await client.query('ROLLBACK');return reply.code(400).send({error:'Payment exceeds outstanding balance',outstanding});}const payment=await client.query(`INSERT INTO payments(invoice_id,method,provider_reference,amount,status,paid_at) VALUES($1,$2,$3,$4,'completed',now()) RETURNING id,invoice_id AS "invoiceId",method,provider_reference AS "providerReference",amount,status,paid_at AS "paidAt"`,[req.params.id,req.body?.method||'cash',req.body?.providerReference||null,amount]);const newPaid=Number(paid.rows[0].total)+amount;const next=newPaid>=Number(inv.rows[0].total)?'paid':'partially-paid';await client.query(`UPDATE invoices SET status=$1 WHERE id=$2`,[next,req.params.id]);await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','payment-receipt','queued',$3)`,[dbOrganizationId(req),inv.rows[0].patientId,JSON.stringify({paymentId:payment.rows[0].id})]);await dbAudit(client,req,'PAY','invoice',req.params.id,{paymentId:payment.rows[0].id,amount});await client.query('COMMIT');return payment.rows[0];}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  const inv=store.billing.find(v=>v.id===req.params.id);if(!inv)throw Object.assign(new Error('Invoice not found'),{statusCode:404});const amount=Number(req.body?.amount||0);if(amount<=0)throw Object.assign(new Error('Payment amount must be positive'),{statusCode:400});const payment=add('payments',{invoiceId:inv.id,patientId:inv.patientId,amount,method:req.body?.method||'cash',status:'completed',paidAt:now()},req);const total=Number(inv.total||0), paid=store.payments.filter(x=>x.invoiceId===inv.id&&x.status==='completed').reduce((s,x)=>s+Number(x.amount||0),0);patch('billing',inv.id,{paidAmount:paid,status:paid>=total?'paid':'partially-paid'},req);add('notifications',{patientId:inv.patientId,channel:'in-app',template:'payment-receipt',status:'queued',payload:{paymentId:payment.id}},req);return payment});

app.post('/api/laboratory/results',async(req:any,reply)=>{
  const b=(req.body||{}) as Row;
  if(!pool) return reply.code(201).send(add('laboratory',{...b,status:'preliminary'},req));
  const client=await pool.connect(); try{await client.query('BEGIN');
    const sample=await client.query(`SELECT ls.id,co.patient_id AS "patientId" FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE ls.id=$1 AND p.organization_id=$2`,[b.sampleId,dbOrganizationId(req)]);
    if(!sample.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Lab sample not found'});}
    let test=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND (id=$2 OR code=$3) LIMIT 1`,[dbOrganizationId(req),b.testId||null,b.code||null]);
    if(!test.rowCount) test=await client.query(`INSERT INTO lab_tests(organization_id,code,name,unit,active) VALUES($1,$2,$3,$4,true) RETURNING id`,[dbOrganizationId(req),b.code||null,b.name||b.code||'Laboratory test',b.unit||null]);
    const r=await client.query(`INSERT INTO lab_results(sample_id,test_id,value_numeric,value_text,unit,abnormal_flag,critical,status) VALUES($1,$2,$3,$4,$5,$6,$7,'preliminary') RETURNING id,sample_id AS "sampleId",test_id AS "testId",value_numeric AS "valueNumeric",value_text AS "valueText",unit,abnormal_flag AS "abnormalFlag",critical,status`,[b.sampleId,test.rows[0].id,b.valueNumeric??null,b.valueText??null,b.unit||null,b.abnormalFlag||null,Boolean(b.critical)]);
    await dbAudit(client,req,'CREATE','lab_result',r.rows[0].id,{patientId:sample.rows[0].patientId}); await queueEvent(client,req,'lab_result.created',{labResultId:r.rows[0].id,patientId:sample.rows[0].patientId}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

// --- Connected clinical actions ---
async function queueEvent(client:any, req:any, type:string, payload:Row){
  if(!pool) return;
  await client.query(`INSERT INTO outbox_events(organization_id,event_type,payload,status) VALUES($1,$2,$3,'pending')`,[dbOrganizationId(req),type,JSON.stringify(payload)]);
}

app.post('/api/actions/:module/:id/:action',async(req:any,reply)=>{
  const {module,id,action}=req.params as {module:string;id:string;action:string};
  const b=(req.body||{}) as Row;
  if(!pool){
    if(module==='queue') return reply.send(patch('queue',id,{status:action},req));
    if(module==='tasks') return reply.send(patch('tasks',id,{status:action==='complete'?'completed':action},req));
    if(module==='clinical-notes') return reply.send(patch('clinical-notes',id,{status:action==='sign'?'signed':action},req));
    if(module==='billing') return reply.send(patch('billing',id,{status:action==='pay'?'paid':action},req));
    return reply.code(400).send({error:'Action not supported in JSON mode'});
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let result:any;
    if(module==='appointments' && action==='check-in'){
      const a=await client.query(`SELECT a.id,a.patient_id AS "patientId",a.facility_id AS "facilityId",a.status FROM appointments a WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE`,[id,dbOrganizationId(req)]);
      if(!a.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Appointment not found'});}
      if(['cancelled','completed','no-show'].includes(a.rows[0].status)){await client.query('ROLLBACK');return reply.code(409).send({error:`Appointment is ${a.rows[0].status}`});}
      await client.query(`UPDATE appointments SET status='checked-in' WHERE id=$1`,[id]);
      let q=await client.query(`SELECT id FROM queues WHERE organization_id=$1 AND facility_id IS NOT DISTINCT FROM $2 ORDER BY created_at LIMIT 1`,[dbOrganizationId(req),a.rows[0].facilityId]);
      if(!q.rowCount) q=await client.query(`INSERT INTO queues(organization_id,facility_id,code,name) VALUES($1,$2,'GENERAL','General Queue') RETURNING id`,[dbOrganizationId(req),a.rows[0].facilityId]);
      const existing=await client.query(`SELECT id,status FROM queue_entries WHERE queue_id=$1 AND patient_id=$2 AND status NOT IN ('completed','cancelled','no-show') LIMIT 1`,[q.rows[0].id,a.rows[0].patientId]);
      let qe=existing.rows[0];
      if(!qe) qe=(await client.query(`INSERT INTO queue_entries(queue_id,patient_id,appointment_id,priority,status) VALUES($1,$2,$3,$4,'waiting-triage') RETURNING id,status`,[q.rows[0].id,a.rows[0].patientId,id,b.priority||'normal'])).rows[0];
      result={appointmentId:id,patientId:a.rows[0].patientId,queueEntryId:qe.id,status:'checked-in',queueStatus:qe.status};
      await dbAudit(client,req,'CHECK_IN','appointment',id,result); await queueEvent(client,req,'appointment.checked_in',result);
    } else if(module==='queue'){
      const allowed=['waiting','called','in-service','completed','cancelled','no-show','waiting-triage','waiting-doctor','emergency'];
      if(!allowed.includes(action)) {await client.query('ROLLBACK');return reply.code(400).send({error:'Invalid queue action'});}
      const r=await client.query(`UPDATE queue_entries qe SET status=$1,called_at=CASE WHEN $1='called' THEN now() ELSE qe.called_at END,completed_at=CASE WHEN $1='completed' THEN now() ELSE qe.completed_at END FROM queues q WHERE qe.id=$2 AND qe.queue_id=q.id AND q.organization_id=$3 RETURNING qe.id,qe.patient_id AS "patientId",qe.appointment_id AS "appointmentId",qe.priority,qe.status,qe.joined_at AS "joinedAt",qe.called_at AS "calledAt",qe.completed_at AS "completedAt"`,[action,id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Queue entry not found'});}
      result=r.rows[0]; await dbAudit(client,req,'QUEUE_TRANSITION','queue_entry',id,{status:action}); await queueEvent(client,req,'queue.transitioned',{queueEntryId:id,status:action});
    } else if(module==='encounters' && action==='complete') {
      const r=await client.query(`UPDATE encounters SET status='completed',ended_at=COALESCE(ended_at,now()) WHERE id=$1 AND organization_id=$2 RETURNING id,patient_id AS "patientId",status,started_at AS "startedAt",ended_at AS "endedAt"`,[id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Encounter not found'});} result=r.rows[0]; await dbAudit(client,req,'COMPLETE','encounter',id,{}); await queueEvent(client,req,'encounter.completed',{encounterId:id});
    } else if(module==='clinical-notes' && action==='sign'){
      const r=await client.query(`UPDATE clinical_notes n SET signed_by=$1,signed_at=now() FROM encounters e WHERE n.id=$2 AND n.encounter_id=e.id AND e.organization_id=$3 AND n.signed_at IS NULL RETURNING n.id,n.encounter_id AS "encounterId",n.signed_at AS "signedAt",n.version`,[dbUserId(req),id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Draft clinical note not found'});}
      result={...r.rows[0],status:'signed'}; await dbAudit(client,req,'SIGN','clinical_note',id,{}); await queueEvent(client,req,'clinical_note.signed',{clinicalNoteId:id});
    } else if(module==='laboratory' && ['collect','receive'].includes(action)) {
      const next=action==='collect'?'collected':'received';
      const stamp=action==='collect'?'collected_at':'received_at';
      const r=await client.query(`UPDATE lab_samples ls SET status=$1,${stamp}=now() FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE ls.id=$2 AND ls.order_id=co.id AND p.organization_id=$3 AND ls.status IN ('ordered','collected') RETURNING ls.id,ls.order_id AS "orderId",ls.barcode,ls.status,ls.collected_at AS "collectedAt",ls.received_at AS "receivedAt"`,[next,id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Lab sample is not in a valid state for this action'});} result=r.rows[0]; await dbAudit(client,req,action.toUpperCase(),'lab_sample',id,{}); await queueEvent(client,req,`lab_sample.${action}`,{sampleId:id,status:next});
    } else if(module==='laboratory' && (action==='verify' || action==='release')){
      if(action==='release'){
        const r=await client.query(`UPDATE lab_results lr SET status='final' FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE lr.id=$1 AND lr.sample_id=ls.id AND p.organization_id=$2 AND lr.status='verified' RETURNING lr.id,lr.sample_id AS "sampleId",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status,lr.verified_at AS "verifiedAt"`,[id,dbOrganizationId(req)]);
        if(!r.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Lab result must be verified before release, or was not found'});} result=r.rows[0];
      } else {
        const r=await client.query(`UPDATE lab_results lr SET status='verified',verified_by=$1,verified_at=now() FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE lr.id=$2 AND lr.sample_id=ls.id AND p.organization_id=$3 AND lr.status IN ('preliminary','ordered') RETURNING lr.id,lr.sample_id AS "sampleId",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status,lr.verified_at AS "verifiedAt"`,[dbUserId(req),id,dbOrganizationId(req)]);
        if(!r.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Lab result is not in a verifiable state'});} result=r.rows[0];
        const lab=await client.query(`SELECT co.patient_id AS "patientId",lr.critical FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE lr.id=$1`,[id]);
        if(lab.rowCount){await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app',$3,'queued',$4)`,[dbOrganizationId(req),lab.rows[0].patientId,lab.rows[0].critical?'critical-lab':'result-ready',JSON.stringify({labResultId:id})]);await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3)`,[dbOrganizationId(req),JSON.stringify({patientId:lab.rows[0].patientId,type:lab.rows[0].critical?'critical-result-review':'result-review',priority:lab.rows[0].critical?'critical':'normal',labResultId:id,status:'open'}),dbUserId(req)]);}
      }
      await dbAudit(client,req,action.toUpperCase(),'lab_result',id,{}); await queueEvent(client,req,`lab_result.${action}`,{labResultId:id,status:result.status});
    } else if(module==='pharmacy' && action==='dispense'){
      const o=await client.query(`SELECT mo.id,mo.patient_id AS "patientId",mo.quantity,mo.status,m.name AS "medicationName",m.code AS "medicationCode" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id WHERE mo.id=$1 AND EXISTS(SELECT 1 FROM patients p WHERE p.id=mo.patient_id AND p.organization_id=$2) FOR UPDATE`,[id,dbOrganizationId(req)]);
      if(!o.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Medication order not found'});}
      if(!['active','partially-dispensed'].includes(o.rows[0].status)){await client.query('ROLLBACK');return reply.code(409).send({error:`Medication order is ${o.rows[0].status}`});}
      const qty=Number(b.quantity||o.rows[0].quantity||1); if(qty<=0){await client.query('ROLLBACK');return reply.code(400).send({error:'Quantity must be positive'});}
      let batchId=b.batchId||null;
      if(!batchId){ const stock=await client.query(`SELECT ib.id,ib.quantity,ib.batch_number AS "batchNumber",ib.expiry_date AS "expiryDate" FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ii.organization_id=$1 AND (ii.sku=$2 OR lower(ii.name)=lower($3)) AND ib.quantity>0 ORDER BY ib.expiry_date NULLS LAST,ib.id LIMIT 1 FOR UPDATE`,[dbOrganizationId(req),o.rows[0].medicationCode||null,o.rows[0].medicationName]); if(stock.rowCount) batchId=stock.rows[0].id; }
      let batchMeta:any=null;
      if(batchId){ const stock=await client.query(`SELECT ib.id,ib.item_id,ib.quantity,ib.batch_number AS "batchNumber",ib.expiry_date AS "expiryDate" FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ib.id=$1 AND ii.organization_id=$2 FOR UPDATE`,[batchId,dbOrganizationId(req)]); if(!stock.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Inventory batch not found'});} if(Number(stock.rows[0].quantity)<qty){await client.query('ROLLBACK');return reply.code(409).send({error:'Insufficient stock',available:Number(stock.rows[0].quantity)});} await client.query(`UPDATE inventory_batches SET quantity=quantity-$1 WHERE id=$2`,[qty,batchId]); await client.query(`INSERT INTO stock_movements(item_id,batch_id,movement_type,quantity,reference_type,reference_id,created_by) VALUES($1,$2,'dispense',$3,'medication_order',$4,$5)`,[stock.rows[0].item_id,batchId,qty,id,dbUserId(req)]); batchMeta={batchId,batch:stock.rows[0].batchNumber,expiryDate:stock.rows[0].expiryDate}; }
      const d=await client.query(`INSERT INTO dispensations(medication_order_id,quantity,batch,expiry_date,dispensed_by) VALUES($1,$2,$3,$4,$5) RETURNING id,medication_order_id AS "medicationOrderId",quantity,batch,expiry_date AS "expiryDate",dispensed_at AS "dispensedAt"`,[id,qty,batchMeta?.batch||b.batch||null,batchMeta?.expiryDate||b.expiryDate||null,dbUserId(req)]);
      const remaining=Number(o.rows[0].quantity||0)-qty; const next=remaining>0?'partially-dispensed':'dispensed'; await client.query(`UPDATE medication_orders SET status=$1 WHERE id=$2`,[next,id]);
      await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','prescription-ready','queued',$3)`,[dbOrganizationId(req),o.rows[0].patientId,JSON.stringify({medicationOrderId:id,quantity:qty})]);
      result={...o.rows[0],status:next,dispensation:d.rows[0],inventory:batchMeta}; await dbAudit(client,req,'DISPENSE','medication_order',id,{quantity:qty,batchId}); await queueEvent(client,req,'medication.dispensed',{medicationOrderId:id,quantity:qty,batchId});
    } else if(module==='billing' && action==='pay'){
      const inv=await client.query(`SELECT id,patient_id AS "patientId",total,status,currency FROM invoices WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,dbOrganizationId(req)]);
      if(!inv.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Invoice not found'});}
      const amount=Number(b.amount||inv.rows[0].total||0); if(amount<=0){await client.query('ROLLBACK');return reply.code(400).send({error:'Payment amount must be positive'});}
      const paid=await client.query(`SELECT COALESCE(SUM(amount),0)::numeric total FROM payments WHERE invoice_id=$1 AND status='completed'`,[id]); const outstanding=Number(inv.rows[0].total)-Number(paid.rows[0].total); if(amount>outstanding+0.0001){await client.query('ROLLBACK');return reply.code(400).send({error:'Payment exceeds outstanding balance',outstanding});}
      const payment=await client.query(`INSERT INTO payments(invoice_id,method,provider_reference,amount,status,paid_at) VALUES($1,$2,$3,$4,'completed',now()) RETURNING id,invoice_id AS "invoiceId",method,provider_reference AS "providerReference",amount,status,paid_at AS "paidAt"`,[id,b.method||'cash',b.providerReference||null,amount]);
      const newPaid=Number(paid.rows[0].total)+amount; await client.query(`UPDATE invoices SET status=$1 WHERE id=$2`,[newPaid>=Number(inv.rows[0].total)?'paid':'partially-paid',id]); await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','payment-receipt','queued',$3)`,[dbOrganizationId(req),inv.rows[0].patientId,JSON.stringify({paymentId:payment.rows[0].id})]);
      result=payment.rows[0]; await dbAudit(client,req,'PAY','invoice',id,{paymentId:payment.rows[0].id,amount}); await queueEvent(client,req,'invoice.paid',{invoiceId:id,paymentId:payment.rows[0].id,amount});
    } else if(module==='tasks' && action==='complete'){
      const r=await client.query(`UPDATE module_records SET payload=jsonb_set(payload,'{status}','"completed"'::jsonb,true),updated_at=now() WHERE id=$1 AND organization_id=$2 AND module='tasks' RETURNING id,status,payload`,[id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Task not found'});} result={id:r.rows[0].id,status:'completed',...r.rows[0].payload}; await dbAudit(client,req,'COMPLETE','task',id,{}); await queueEvent(client,req,'task.completed',{taskId:id});
    } else if(module==='inpatient' && action==='discharge'){
      const body=b; const p=await client.query(`SELECT id FROM patients WHERE id=$1 AND organization_id=$2`,[body.patientId,dbOrganizationId(req)]); if(!p.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}
      const f=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'inpatient','discharged',$2,$3) RETURNING id`,[dbOrganizationId(req),JSON.stringify({...body,status:'discharged',dischargedAt:now()}),dbUserId(req)]); const fu=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'follow-up','due',$2,$3) RETURNING id`,[dbOrganizationId(req),JSON.stringify({patientId:body.patientId,reason:body.followUpReason||'Post-discharge follow-up',dueAt:body.followUpDate||null,status:'due'}),dbUserId(req)]); result={inpatientRecordId:f.rows[0].id,followUpId:fu.rows[0].id,status:'discharged'}; await dbAudit(client,req,'DISCHARGE','patient',body.patientId,result); await queueEvent(client,req,'patient.discharged',{patientId:body.patientId,followUpId:fu.rows[0].id});
    } else if(module==='referrals' && action==='send'){
      const r=await client.query(`UPDATE referrals r SET status='sent' FROM patients p WHERE r.id=$1 AND r.patient_id=p.id AND p.organization_id=$2 RETURNING r.id,r.patient_id AS "patientId",r.destination,r.reason,r.status`,[id,dbOrganizationId(req)]); if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Referral not found'});} await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3)`,[dbOrganizationId(req),JSON.stringify({patientId:r.rows[0].patientId,type:'referral-tracking',referralId:id,status:'open'}),dbUserId(req)]); result=r.rows[0]; await dbAudit(client,req,'SEND','referral',id,{}); await queueEvent(client,req,'referral.sent',{referralId:id});
    } else { await client.query('ROLLBACK'); return reply.code(400).send({error:`Unsupported action ${action} for ${module}`}); }
    await client.query('COMMIT'); return reply.send(result);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.post('/api/medication-administrations',async(req:any,reply)=>{
  const b=z.object({medicationOrderId:z.string().uuid(),dose:z.string().optional(),route:z.string().optional(),scheduledAt:z.string().optional(),status:z.enum(['given','held','refused','missed']).default('given'),reason:z.string().optional()}).parse(req.body);
  if(!pool)return reply.code(201).send(add('nursing',{...b,administeredAt:now()},req));
  const client=await pool.connect(); try{await client.query('BEGIN'); const mo=await client.query(`SELECT mo.id,mo.patient_id AS "patientId" FROM medication_orders mo JOIN patients p ON p.id=mo.patient_id WHERE mo.id=$1 AND p.organization_id=$2`,[b.medicationOrderId,dbOrganizationId(req)]); if(!mo.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Medication order not found'});} const r=await client.query(`INSERT INTO medication_administrations(medication_order_id,dose,route,scheduled_at,administered_at,status,administered_by,reason) VALUES($1,$2,$3,$4,CASE WHEN $5 IN ('given','held','refused') THEN now() ELSE NULL END,$5,$6,$7) RETURNING id,medication_order_id AS "medicationOrderId",dose,route,scheduled_at AS "scheduledAt",administered_at AS "administeredAt",status,reason`,[b.medicationOrderId,b.dose||null,b.route||null,b.scheduledAt||null,b.status,dbUserId(req),b.reason||null]); await dbAudit(client,req,'ADMINISTER_MEDICATION','medication_order',b.medicationOrderId,{status:b.status}); await queueEvent(client,req,'medication.administration_recorded',{medicationOrderId:b.medicationOrderId,administrationId:r.rows[0].id,status:b.status}); await client.query('COMMIT'); return reply.code(201).send({...r.rows[0],patientId:mo.rows[0].patientId}); }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

// --- Database-backed clinical results, inventory and audit/search ---
app.get('/api/laboratory/samples',async(req:any)=>{
  if(!pool)return {data:store.laboratory.filter(x=>x.sampleId||x.orderId),count:store.laboratory.length};
  const params:any[]=[dbOrganizationId(req)]; let where='p.organization_id=$1'; if(req.query?.orderId){params.push(String(req.query.orderId));where+=' AND ls.order_id=$2';}
  const r=await pool.query(`SELECT ls.id,ls.order_id AS "orderId",co.patient_id AS "patientId",ls.barcode,ls.specimen_type AS "specimenType",ls.status,ls.collected_at AS "collectedAt",ls.received_at AS "receivedAt",ls.processed_at AS "processedAt" FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE ${where} ORDER BY ls.id DESC LIMIT 500`,params); return {data:r.rows,count:r.rowCount};
});

app.get('/api/laboratory/results',async(req:any)=>{
  if(!pool) return {data:store.laboratory.filter(x=>x.organizationId===org(req)),count:store.laboratory.length};
  const r=await pool.query(`SELECT lr.id,co.patient_id AS "patientId",ls.barcode,lt.code,lt.name,lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status,lr.verified_at AS "verifiedAt" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 ORDER BY lr.id DESC LIMIT 500`,[dbOrganizationId(req)]); return {data:r.rows,count:r.rowCount};
});
app.get('/api/medication-administrations',async(req:any)=>{ if(!pool)return {data:store.nursing.filter(x=>x.medicationOrderId),count:store.nursing.length}; const r=await pool.query(`SELECT ma.id,ma.medication_order_id AS "medicationOrderId",mo.patient_id AS "patientId",ma.dose,ma.route,ma.scheduled_at AS "scheduledAt",ma.administered_at AS "administeredAt",ma.status,ma.reason,ma.administered_by AS "administeredBy" FROM medication_administrations ma JOIN medication_orders mo ON mo.id=ma.medication_order_id JOIN patients p ON p.id=mo.patient_id WHERE p.organization_id=$1 ORDER BY ma.administered_at DESC NULLS LAST LIMIT 500`,[dbOrganizationId(req)]); return {data:r.rows,count:r.rowCount}; });

app.get('/api/audit',async(req:any)=>{
  if(!pool) return audit.slice(-500).reverse();
  const r=await pool.query(`SELECT id,actor_user_id AS "actorUserId",action,entity_type AS "entityType",entity_id AS "entityId",metadata,created_at AS "createdAt" FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]); return r.rows;
});
app.get('/api/search',async(req:any)=>{
  const q=String(req.query?.q||'').trim(); if(!q)return {patients:[],encounters:[],appointments:[],orders:[]};
  if(!pool){const needle=q.toLowerCase();const match=(r:Row)=>Object.values(r).some(v=>typeof v==='string'&&v.toLowerCase().includes(needle));return {patients:store.patients.filter(match).slice(0,20),encounters:store.encounters.filter(match).slice(0,20),appointments:store.appointments.filter(match).slice(0,20),orders:store.orders.filter(match).slice(0,20)};}
  const like=`%${q}%`; const oid=dbOrganizationId(req);
  const [p,e,a,o]=await Promise.all([
    pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",phone FROM patients WHERE organization_id=$1 AND (patient_number ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR COALESCE(phone,'') ILIKE $2) ORDER BY created_at DESC LIMIT 20`,[oid,like]),
    pool.query(`SELECT e.id,e.patient_id AS "patientId",e.type,e.status,e.started_at AS "startedAt" FROM encounters e WHERE e.organization_id=$1 AND (e.id::text ILIKE $2 OR e.type ILIKE $2 OR e.status ILIKE $2) ORDER BY e.started_at DESC LIMIT 20`,[oid,like]),
    pool.query(`SELECT a.id,a.patient_id AS "patientId",a.status,a.reason,a.start_at AS "startAt" FROM appointments a WHERE a.organization_id=$1 AND (a.id::text ILIKE $2 OR COALESCE(a.reason,'') ILIKE $2 OR a.status ILIKE $2) ORDER BY a.start_at DESC LIMIT 20`,[oid,like]),
    pool.query(`SELECT co.id,co.patient_id AS "patientId",co.order_type AS category,co.status,co.priority,co.details FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 AND (co.id::text ILIKE $2 OR co.order_type ILIKE $2 OR co.status ILIKE $2 OR co.details::text ILIKE $2) ORDER BY co.created_at DESC LIMIT 20`,[oid,like])
  ]); return {patients:p.rows,encounters:e.rows,appointments:a.rows,orders:o.rows};
});

// --- FHIR R4 resource endpoints ---
app.get('/api/fhir/Encounter/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR Encounter requires PostgreSQL'});
  const r=await pool.query(`SELECT e.id,e.patient_id,e.status,e.type,e.started_at,e.ended_at FROM encounters e WHERE e.id=$1 AND e.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Encounter not found'}]}); const x=r.rows[0]; return {resourceType:'Encounter',id:x.id,status:x.status,class:{system:'http://terminology.hl7.org/CodeSystem/v3-ActCode',code:x.type},subject:{reference:`Patient/${x.patient_id}`},period:{start:x.started_at,end:x.ended_at}};
});
app.get('/api/fhir/Observation/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR Observation requires PostgreSQL'}); const r=await pool.query(`SELECT o.id,o.patient_id,o.encounter_id,o.code_system,o.code,o.display,o.value_numeric,o.value_text,o.unit,o.observed_at FROM observations o JOIN patients p ON p.id=o.patient_id WHERE o.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Observation not found'}]}); const x=r.rows[0]; const value=x.value_numeric!==null?{value:Number(x.value_numeric),unit:x.unit}:x.value_text!==null?{value:x.value_text}:undefined; return clean({resourceType:'Observation',id:x.id,status:'final',code:{coding:x.code?[{system:x.code_system||undefined,code:x.code,display:x.display}]:undefined,text:x.display},subject:{reference:`Patient/${x.patient_id}`},encounter:x.encounter_id?{reference:`Encounter/${x.encounter_id}`}:undefined,effectiveDateTime:x.observed_at,valueQuantity:value&&typeof value.value==='number'?value:undefined,valueString:value&&typeof value.value==='string'?value.value:undefined});
});
app.get('/api/fhir/MedicationRequest/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR MedicationRequest requires PostgreSQL'}); const r=await pool.query(`SELECT mo.id,mo.patient_id,mo.encounter_id,mo.dose,mo.frequency,mo.route,mo.duration,mo.quantity,mo.status,m.code,m.name,m.strength,m.form FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id JOIN patients p ON p.id=mo.patient_id WHERE mo.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Medication order not found'}]}); const x=r.rows[0]; return clean({resourceType:'MedicationRequest',id:x.id,status:x.status,intent:'order',medicationCodeableConcept:{coding:x.code?[{system:'https://clinai.health/medication',code:x.code,display:x.name}]:undefined,text:[x.name,x.strength,x.form].filter(Boolean).join(' ')},subject:{reference:`Patient/${x.patient_id}`},encounter:x.encounter_id?{reference:`Encounter/${x.encounter_id}`}:undefined,dosageInstruction:[{text:[x.dose,x.frequency,x.route,x.duration].filter(Boolean).join(' ')}],dispenseRequest:x.quantity?{quantity:{value:Number(x.quantity)}}:undefined});
});


app.get('/api/fhir/DiagnosticReport/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR DiagnosticReport requires PostgreSQL'});
  const r=await pool.query(`SELECT lr.id,co.patient_id,ls.order_id,lt.code,lt.name,lr.status,lr.value_numeric,lr.value_text,lr.unit,lr.critical,lr.verified_at FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id JOIN patients p ON p.id=co.patient_id WHERE lr.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]);
  if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Diagnostic report not found'}]}); const x=r.rows[0];
  return clean({resourceType:'DiagnosticReport',id:x.id,status:x.status==='released'?'final':x.status==='verified'?'final':'preliminary',code:{coding:[{system:'https://clinai.health/lab',code:x.code,display:x.name}]},subject:{reference:`Patient/${x.patient_id}`},basedOn:[{reference:`ServiceRequest/${x.order_id}`}],issued:x.verified_at});
});
app.get('/api/fhir/ServiceRequest/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR ServiceRequest requires PostgreSQL'}); const r=await pool.query(`SELECT co.id,co.patient_id,co.order_type,co.priority,co.status,co.details,co.created_at FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE co.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Service request not found'}]}); const x=r.rows[0]; return {resourceType:'ServiceRequest',id:x.id,status:x.status==='ordered'?'active':x.status,intent:'order',priority:x.priority,code:{text:x.details?.description||x.order_type,coding:x.details?.code?[{system:'https://clinai.health/order',code:x.details.code}]:undefined},subject:{reference:`Patient/${x.patient_id}`},authoredOn:x.created_at};
});

// --- Interoperability and persistence health ---
app.get('/api/system/persistence',async(_req,reply)=>{
  if(!pool) return {mode:'development-json',database:false};
  try { const r=await pool.query('select now() as time'); return {mode:'postgresql',database:true,time:r.rows[0].time}; }
  catch(e:any){ return reply.code(503).send({mode:'postgresql',database:false,error:e.message}); }
});

function clean(o:Row){ const out:Row={}; for(const [k,v] of Object.entries(o)) if(v!==undefined) out[k]=v; return out; }
function fhirPatient(p:Row){
  return clean({resourceType:'Patient',id:p.id,identifier:[{system:'https://clinai.health/patient-number',value:p.patientNumber}],name:[{family:p.lastName,given:[p.firstName]}],gender:p.sex==='unknown'?undefined:p.sex,birthDate:p.dateOfBirth,telecom:[p.phone?{system:'phone',value:p.phone}:null,p.email?{system:'email',value:p.email}:null].filter(Boolean),address:p.address?[{text:p.address}]:undefined});
}
app.get('/api/fhir/Patient/:id',async(req:any,reply)=>{
  let p:any; if(pool){const r=await pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",middle_name AS "middleName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,phone,email,address FROM patients WHERE id=$1 AND organization_id=$2`,[req.params.id,dbOrganizationId(req)]); p=r.rows[0];} else p=store.patients.find(x=>x.id===req.params.id && x.organizationId===org(req));
  if(!p) return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Patient not found'}]});
  return fhirPatient(p);
});
app.get('/api/fhir/Patient',async(req:any)=>{
  const q=String(req.query?.identifier||req.query?.name||'').trim();
  let rows:any[]=[];
  if(pool){const params:any[]=[dbOrganizationId(req)];let where='organization_id=$1';if(q){params.push(`%${q}%`);where+=' AND (patient_number ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2)';}const r=await pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,phone,email,address FROM patients WHERE ${where} ORDER BY created_at DESC LIMIT 100`,params);rows=r.rows;}else rows=store.patients.filter(x=>x.organizationId===org(req)).filter(x=>!q || `${x.patientNumber} ${x.firstName} ${x.lastName}`.toLowerCase().includes(q.toLowerCase())).slice(0,100);
  return {resourceType:'Bundle',type:'searchset',total:rows.length,entry:rows.map(x=>({fullUrl:`urn:uuid:${x.id}`,resource:fhirPatient(x)}))};
});

app.post('/api/clinical/observations',async(req:any,reply)=>{
  const body=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),code:z.string(),display:z.string().optional(),valueNumeric:z.number().optional(),valueText:z.string().optional(),unit:z.string().optional()}).parse(req.body);
  if(!pool)return reply.code(201).send(add('clinical-notes',{kind:'observation',...body,recordedAt:now()},req));
  const r=await pool.query(`INSERT INTO observations(patient_id,encounter_id,code,display,value_numeric,value_text,unit,performer_user_id) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$9) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",code,display,value_numeric AS "valueNumeric",value_text AS "valueText",unit,observed_at AS "observedAt"`,[body.patientId,body.encounterId||null,body.code,body.display||null,body.valueNumeric??null,body.valueText??null,body.unit||null,dbUserId(req),dbOrganizationId(req)]);
  if(!r.rowCount)return reply.code(404).send({error:'Patient not found'});return reply.code(201).send(r.rows[0]);
});
app.post('/api/clinical/notes/:encounterId/sign',async(req:any,reply)=>{
  if(pool){
    const client=await pool.connect();
    try{ await client.query('BEGIN');
      const n=await client.query(`SELECT cn.id,cn.encounter_id AS "encounterId",e.patient_id AS "patientId",cn.signed_at AS "signedAt" FROM clinical_notes cn JOIN encounters e ON e.id=cn.encounter_id WHERE cn.encounter_id=$1 AND e.organization_id=$2 ORDER BY cn.version DESC LIMIT 1`,[req.params.encounterId,dbOrganizationId(req)]);
      if(!n.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Clinical note not found'});}
      if(n.rows[0].signedAt){await client.query('ROLLBACK');return reply.code(409).send({error:'Clinical note is already signed'});}
      const r=await client.query(`UPDATE clinical_notes SET signed_by=$1,signed_at=now() WHERE id=$2 RETURNING id,encounter_id AS "encounterId",note_type AS "noteType",subjective,objective,assessment,plan,signed_by AS "signedBy",signed_at AS "signedAt",version`,[dbUserId(req),n.rows[0].id]);
      await dbAudit(client,req,'SIGN','clinical_note',n.rows[0].id,{encounterId:req.params.encounterId}); await client.query('COMMIT'); return r.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  const note=store['clinical-notes'].find(x=>x.encounterId===req.params.encounterId && x.organizationId===org(req));
  if(!note) return reply.code(404).send({error:'Clinical note not found'});
  if(note.signedAt) return reply.code(409).send({error:'Clinical note is already signed'});
  const updated=patch('clinical-notes',note.id,{signedAt:now(),signedBy:actor(req),status:'signed'},req);
  audit.push({id:randomUUID(),action:'CLINICAL_NOTE_SIGNED',resourceId:note.id,patientId:note.patientId,actorId:actor(req),at:now()}); persist(); return updated;
});
app.post('/api/appointments/:id/check-in',async(req:any,reply)=>{
  if(pool){
    const client=await pool.connect();
    try{await client.query('BEGIN');
      const a=await client.query(`UPDATE appointments SET status='arrived' WHERE id=$1 AND organization_id=$2 RETURNING id,patient_id AS "patientId",facility_id AS "facilityId",status,start_at AS "startAt"`,[req.params.id,dbOrganizationId(req)]);
      if(!a.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Appointment not found'});}
      const q0=await client.query(`SELECT id FROM queues WHERE organization_id=$1 AND code='OUTPATIENT' LIMIT 1`,[dbOrganizationId(req)]);
      let qid=q0.rows[0]?.id;
      if(!qid){const q=await client.query(`INSERT INTO queues(organization_id,facility_id,code,name) VALUES($1,$2,'OUTPATIENT','Outpatient Queue') RETURNING id`,[dbOrganizationId(req),a.rows[0].facilityId||null]);qid=q.rows[0].id;}
      const q=await client.query(`INSERT INTO queue_entries(queue_id,patient_id,appointment_id,priority,status) VALUES($1,$2,$3,'normal','waiting-triage') RETURNING id,patient_id AS "patientId",appointment_id AS "appointmentId",priority,status,joined_at AS "joinedAt"`,[qid,a.rows[0].patientId,a.rows[0].id]);
      const reg=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'registration','checked-in',$2,$3) RETURNING id`,[dbOrganizationId(req),JSON.stringify({patientId:a.rows[0].patientId,appointmentId:a.rows[0].id,status:'checked-in',checkedInAt:now()}),dbUserId(req)]);
      await dbAudit(client,req,'CHECK_IN','appointment',a.rows[0].id,{queueEntryId:q.rows[0].id,registrationId:reg.rows[0].id}); await client.query('COMMIT'); return {appointment:a.rows[0],queue:q.rows[0],registrationId:reg.rows[0].id};
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  const a=store.appointments.find(x=>x.id===req.params.id && x.organizationId===org(req)); if(!a)return reply.code(404).send({error:'Appointment not found'}); patch('appointments',a.id,{status:'arrived',arrivedAt:now()},req); const q=add('queue',{patientId:a.patientId,appointmentId:a.id,facilityId:a.facilityId,status:'waiting-triage',priority:'normal'},req); add('registration',{patientId:a.patientId,appointmentId:a.id,status:'checked-in',checkedInAt:now()},req); return {appointment:a,queue:q};
});
app.post('/api/laboratory/:id/verify',async(req:any,reply)=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE module_records SET status='verified',payload=payload || $1::jsonb,updated_at=now() WHERE id=$2 AND organization_id=$3 AND module='laboratory' RETURNING id,payload,status`,[JSON.stringify({verifiedAt:now(),critical:Boolean(req.body?.critical),abnormalFlag:req.body?.abnormalFlag||null,verifiedBy:dbUserId(req)}),req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Lab record not found'});}const x=r.rows[0];const p=x.payload as any;await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3)`,[dbOrganizationId(req),JSON.stringify({patientId:p.patientId,type:p.critical?'critical-result-review':'result-review',status:'open',priority:p.critical?'critical':'normal',referenceId:x.id}),dbUserId(req)]);await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app',$3,'queued',$4)`,[dbOrganizationId(req),p.patientId,p.critical?'critical-lab':'result-ready',JSON.stringify({laboratoryId:x.id})]);await dbAudit(client,req,'VERIFY','laboratory',x.id,{critical:Boolean(p.critical)});await client.query('COMMIT');return {id:x.id,...p,status:'verified'};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  const x=patch('laboratory',req.params.id,{status:'verified',verifiedAt:now(),verifiedBy:actor(req),critical:Boolean(req.body?.critical),abnormalFlag:req.body?.abnormalFlag||null},req);if(!x)throw Object.assign(new Error('Lab record not found'),{statusCode:404});add('notifications',{patientId:x.patientId,channel:'in-app',template:x.critical?'critical-lab':'result-ready',status:'queued',payload:{laboratoryId:x.id}},req);add('tasks',{patientId:x.patientId,type:x.critical?'critical-result-review':'result-review',status:'open',priority:x.critical?'critical':'normal',referenceId:x.id},req);return x;
});
app.post('/api/laboratory/:id/release',async(req:any,reply)=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT id,payload,status FROM module_records WHERE id=$1 AND organization_id=$2 AND module='laboratory' FOR UPDATE`,[req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Lab record not found'});}if(r.rows[0].status!=='verified'){await client.query('ROLLBACK');return reply.code(409).send({error:'Result must be verified before release'});}const p=r.rows[0].payload as any;const u=await client.query(`UPDATE module_records SET status='released',payload=payload || $1::jsonb,updated_at=now() WHERE id=$2 RETURNING id,payload,status,updated_at AS "updatedAt"`,[JSON.stringify({releasedAt:now(),releasedBy:dbUserId(req)}),req.params.id]);await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','result-ready','queued',$3)`,[dbOrganizationId(req),p.patientId,JSON.stringify({laboratoryId:req.params.id})]);await dbAudit(client,req,'RELEASE','laboratory',req.params.id,{});await client.query('COMMIT');return {id:u.rows[0].id,...u.rows[0].payload,status:u.rows[0].status,updatedAt:u.rows[0].updatedAt};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  const x=store.laboratory.find(v=>v.id===req.params.id && v.organizationId===org(req));if(!x)return reply.code(404).send({error:'Lab record not found'});if(x.status!=='verified')return reply.code(409).send({error:'Result must be verified before release'});const released=patch('laboratory',x.id,{status:'released',releasedAt:now(),releasedBy:actor(req)},req);add('notifications',{patientId:x.patientId,channel:'in-app',template:'result-ready',status:'queued',payload:{laboratoryId:x.id}},req);return released;
});
app.post('/api/tasks/:id/complete',async(req:any,reply)=>{
  if(pool){const r=await pool.query(`UPDATE module_records SET status='completed',payload=payload || $1::jsonb,updated_at=now() WHERE id=$2 AND organization_id=$3 AND module='tasks' RETURNING id,payload,status,updated_at AS "updatedAt"`,[JSON.stringify({completedAt:now(),completedBy:dbUserId(req),resolution:req.body?.resolution||null}),req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Task not found'});await pool.query('INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[dbOrganizationId(req),dbUserId(req),'COMPLETE','task',r.rows[0].id,JSON.stringify({})]);return {id:r.rows[0].id,...r.rows[0].payload,status:r.rows[0].status,updatedAt:r.rows[0].updatedAt};}
  const x=store.tasks.find(v=>v.id===req.params.id && v.organizationId===org(req));if(!x)return reply.code(404).send({error:'Task not found'});return patch('tasks',x.id,{status:'completed',completedAt:now(),completedBy:actor(req),resolution:req.body?.resolution||null},req);
});


app.post('/api/laboratory/:sampleId/result',async(req:any,reply)=>{
  const b=z.object({testCode:z.string().optional(),testName:z.string().default('Lab Test'),valueNumeric:z.number().optional(),valueText:z.string().optional(),unit:z.string().optional(),abnormalFlag:z.string().optional(),critical:z.boolean().default(false)}).parse(req.body||{});
  if(!pool)return reply.code(201).send(add('laboratory',{sampleId:req.params.sampleId,...b,status:'preliminary'},req));
  const client=await pool.connect();try{await client.query('BEGIN');const s=await client.query(`SELECT ls.id,co.patient_id AS "patientId" FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE ls.id=$1 AND p.organization_id=$2 FOR UPDATE`,[req.params.sampleId,dbOrganizationId(req)]);if(!s.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Lab sample not found'});}let t=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND (code=$2 OR lower(name)=lower($3)) LIMIT 1`,[dbOrganizationId(req),b.testCode||null,b.testName]);if(!t.rowCount)t=await client.query(`INSERT INTO lab_tests(organization_id,code,name,unit) VALUES($1,$2,$3,$4) RETURNING id`,[dbOrganizationId(req),b.testCode||null,b.testName,b.unit||null]);const r=await client.query(`INSERT INTO lab_results(sample_id,test_id,value_numeric,value_text,unit,abnormal_flag,critical,status,verified_by,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,'preliminary',NULL,NULL) RETURNING id,sample_id AS "sampleId",value_numeric AS "valueNumeric",value_text AS "valueText",unit,abnormal_flag AS "abnormalFlag",critical,status,verified_at AS "verifiedAt"`,[req.params.sampleId,t.rows[0].id,b.valueNumeric??null,b.valueText??null,b.unit||null,b.abnormalFlag||null,b.critical,dbUserId(req)]);await client.query(`UPDATE lab_samples SET status='processed',processed_at=now() WHERE id=$1`,[req.params.sampleId]);await dbAudit(client,req,'CREATE','lab_result',r.rows[0].id,{patientId:s.rows[0].patientId});await client.query('COMMIT');return reply.code(201).send({...r.rows[0],patientId:s.rows[0].patientId});}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.get('/api/patients/:id/care-summary',async(req:any,reply)=>{
  const id=req.params.id; if(!pool){const p=store.patients.find(x=>x.id===id&&x.organizationId===org(req));if(!p)return reply.code(404).send({error:'Patient not found'});return {patient:p,activeProblems:store.diagnoses.filter(x=>x.patientId===id),medications:store.pharmacy.filter(x=>x.patientId===id&&x.status!=='discontinued'),openTasks:store.tasks.filter(x=>x.patientId===id&&x.status!=='completed')};}
  const p=await pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,phone,email,status FROM patients WHERE id=$1 AND organization_id=$2`,[id,dbOrganizationId(req)]);if(!p.rowCount)return reply.code(404).send({error:'Patient not found'});
  const [dx,med,tasks,alerts]=await Promise.all([
    pool.query(`SELECT id,code,display,diagnosis_type AS "diagnosisType",status FROM diagnoses WHERE patient_id=$1 AND status <> 'resolved' ORDER BY id DESC LIMIT 50`,[id]),
    pool.query(`SELECT mo.id,mo.dose,mo.frequency,mo.route,mo.duration,mo.quantity,mo.status,m.code AS "medicationCode",m.name AS "medicationName" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id WHERE mo.patient_id=$1 AND mo.status NOT IN ('discontinued','completed') ORDER BY mo.id DESC LIMIT 50`,[id]),
    pool.query(`SELECT id,status,payload,created_at AS "createdAt" FROM module_records WHERE organization_id=$1 AND module='tasks' AND payload->>'patientId'=$2 AND status <> 'completed' ORDER BY created_at DESC LIMIT 50`,[dbOrganizationId(req),id]),
    pool.query(`SELECT id,channel,template,status,payload,created_at AS "createdAt" FROM notifications WHERE organization_id=$1 AND patient_id=$2 AND status NOT IN ('sent','resolved') ORDER BY created_at DESC LIMIT 50`,[dbOrganizationId(req),id])
  ]);return {patient:p.rows[0],activeProblems:dx.rows,medications:med.rows,openTasks:tasks.rows,alerts:alerts.rows};
});





app.post('/api/ai/assist',async(req:any,reply)=>{
  const b=z.object({patientId:z.string().uuid().optional(),purpose:z.string().min(1),question:z.string().min(1),clinicalContext:z.record(z.any()).default({}),approvalStatus:z.enum(['pending','approved','rejected']).default('pending')}).parse(req.body||{});
  const service=process.env.AI_SERVICE_URL;if(!service)return reply.code(503).send({error:'AI service is not configured',status:'review_required'});
  try{const r=await fetch(`${service.replace(/\/$/,'')}/v1/assist`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({patient_id:b.patientId||null,purpose:b.purpose,question:b.question,clinical_context:b.clinicalContext})});const out=await r.json();if(!r.ok)return reply.code(502).send({error:'AI service request failed',details:out});if(pool){const inputHash=createHash('sha256').update(JSON.stringify({purpose:b.purpose,question:b.question,clinicalContext:b.clinicalContext})).digest('hex');await pool.query(`INSERT INTO ai_interactions(organization_id,patient_id,actor_user_id,model,model_version,prompt_version,purpose,input_hash,output,approval_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[dbOrganizationId(req),b.patientId||null,dbUserId(req),out.model||'clinai-ai-service',out.model_version||null,out.prompt_version||'v1',b.purpose,inputHash,JSON.stringify(out),b.approvalStatus]);}return {status:'review_required',purpose:b.purpose,answer:out.answer??null,safety:out.safety||['Clinician review required'],provenance:out.provenance||[],model:out.model||'clinai-ai-service'};}catch(e:any){return reply.code(502).send({error:'AI service unavailable',message:e.message});}
});

app.setErrorHandler((err:any,_req,reply)=>{app.log.error(err);reply.code(err.statusCode||500).send({error:err.message||'Request failed',issues:err.issues});});
await app.listen({port:Number(process.env.PORT||4000),host:'0.0.0.0'});

