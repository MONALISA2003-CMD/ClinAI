import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Pool } from 'pg';

const app = Fastify({ logger: true });
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) : null;
await app.register(cors, { origin: true });
await app.register(jwt, { secret: process.env.JWT_SECRET || 'clinai-local-development-secret' });

const modules = ['command-center','patients','appointments','registration','queue','triage','encounters','clinical-notes','diagnoses','orders','laboratory','imaging','pharmacy','nursing','emergency','inpatient','surgery','maternity','pediatrics','immunization','care-plans','referrals','follow-up','billing','payments','insurance','claims','inventory','procurement','suppliers','patient-portal','notifications','telemedicine','remote-monitoring','analytics','population-health','ai','interoperability','trust','staff','facilities','tasks','workflows'] as const;
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
function add(m:Mod, data:Row, req:any){ const row={id:data.id||randomUUID(), organizationId:data.organizationId||org(req), createdAt:data.createdAt||now(), updatedAt:now(), ...data}; store[m].push(row); audit.push({id:randomUUID(),action:'CREATE',module:m,resourceId:row.id,actorId:actor(req),at:now()}); events.push({id:randomUUID(),type:`${m}.created`,payload:row,at:now()}); persist(); return row; }
function patch(m:Mod,id:string,data:Row,req:any){ const row=store[m].find(x=>x.id===id && x.organizationId===req.user?.organizationId); if(!row) return null; Object.assign(row,data,{updatedAt:now()}); audit.push({id:randomUUID(),action:'UPDATE',module:m,resourceId:id,actorId:actor(req),at:now()}); events.push({id:randomUUID(),type:`${m}.updated`,payload:row,at:now()}); persist(); return row; }
function remove(m:Mod,id:string,req:any){ const i=store[m].findIndex(x=>x.id===id && x.organizationId===req.user?.organizationId); if(i<0)return false; store[m].splice(i,1); audit.push({id:randomUUID(),action:'DELETE',module:m,resourceId:id,actorId:actor(req),at:now()}); persist(); return true; }

const patient=z.object({firstName:z.string().min(1),lastName:z.string().min(1),dateOfBirth:z.string().optional(),sex:z.enum(['male','female','intersex','unknown']).optional(),phone:z.string().optional(),email:z.string().email().optional(),nationalId:z.string().optional(),preferredLanguage:z.string().optional(),address:z.string().optional()});
const appointment=z.object({patientId:z.string(),providerId:z.string().optional(),facilityId:z.string().optional(),startAt:z.string(),durationMinutes:z.number().int().positive().default(30),type:z.string().default('consultation'),reason:z.string().optional(),status:z.string().default('scheduled')});
const encounter=z.object({patientId:z.string(),appointmentId:z.string().optional(),providerId:z.string().optional(),facilityId:z.string().optional(),reason:z.string().optional(),type:z.string().default('outpatient'),status:z.string().default('in-progress')});
const order=z.object({patientId:z.string(),encounterId:z.string().optional(),category:z.enum(['laboratory','imaging','medication','procedure']),code:z.string().min(1),description:z.string().optional(),priority:z.enum(['routine','urgent','stat']).default('routine'),details:z.record(z.any()).optional()});
const triage=z.object({patientId:z.string(),encounterId:z.string().optional(),chiefComplaint:z.string().optional(),temperature:z.number().optional(),heartRate:z.number().optional(),respiratoryRate:z.number().optional(),systolic:z.number().optional(),diastolic:z.number().optional(),spo2:z.number().optional(),pain:z.number().min(0).max(10).optional(),acuity:z.enum(['routine','urgent','emergency']).default('routine')});
const generic=z.record(z.any());

app.get('/health',async()=>({ok:true,service:'clinai-api',time:now(),persistence:true}));
app.get('/api/modules',async()=>modules);
app.post('/api/auth/demo',async()=>({token:await app.jwt.sign({sub:'demo-user',role:'admin',organizationId:'demo-org'},{expiresIn:'8h'})}));
app.addHook('preHandler',async(req)=>{if(req.url==='/health'||req.url==='/api/auth/demo')return;try{await req.jwtVerify(); if((req.method==='POST'||req.method==='PATCH'||req.method==='DELETE') && !canWrite(req)) throw Object.assign(new Error('Insufficient role permissions'),{statusCode:403});}catch(e:any){if(e.statusCode) throw e; throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })}});

app.get('/api/dashboard',async()=>{const count=(m:Mod)=>store[m].length; return {patients:count('patients'),appointments:count('appointments'),waiting:store.queue.filter(x=>['waiting','waiting-triage','waiting-doctor'].includes(x.status)).length,criticalLabs:store.laboratory.filter(x=>x.critical).length,openTasks:store.tasks.filter(x=>x.status==='open').length,unpaid:store.billing.filter(x=>x.status!=='paid').length};});
app.get('/api/audit',async()=>audit.slice(-500).reverse()); app.get('/api/events',async()=>events.slice(-500).reverse());
app.get('/api/:module',async(req:any)=>{const m=req.params.module as Mod;if(!store[m])throw Object.assign(new Error('Unknown module'), { statusCode: 404 }); const q=req.query||{}; let data=store[m].filter(x=>x.organizationId===org(req)); if(q.patientId)data=data.filter(x=>x.patientId===q.patientId); if(q.status)data=data.filter(x=>x.status===q.status); return {data:data.reverse(),count:data.length};});
app.get('/api/:module/:id',async(req:any)=>{const m=req.params.module as Mod;if(!store[m])throw Object.assign(new Error('Not found'), { statusCode: 404 });const row=store[m].find(x=>x.id===req.params.id && x.organizationId===org(req));if(!row)throw Object.assign(new Error('Not found'), { statusCode: 404 });return row;});

app.post('/api/patients',async(req:any,reply)=>{const p=patient.parse(req.body);const duplicate=store.patients.find(x=>x.phone&&p.phone&&x.phone===p.phone&&x.lastName.toLowerCase()===p.lastName.toLowerCase());if(duplicate)return reply.code(409).send({error:'Possible duplicate patient',duplicate});const n=`CLN-${String(store.patients.length+1).padStart(6,'0')}`;return reply.code(201).send(add('patients',{...p,patientNumber:n,status:'active'},req));});
app.post('/api/appointments',async(req:any,reply)=>{const p=appointment.parse(req.body);if(!store.patients.some(x=>x.id===p.patientId))return reply.code(400).send({error:'Patient not found'});const a=add('appointments',p,req);return reply.code(201).send(a);});
app.post('/api/encounters',async(req:any,reply)=>{const e=encounter.parse(req.body);const x=add('encounters',e,req);add('tasks',{patientId:e.patientId,encounterId:x.id,type:'clinical-review',status:'open',priority:'normal'},req);return reply.code(201).send(x);});
app.post('/api/triage',async(req:any,reply)=>{const t=triage.parse(req.body);const x=add('triage',{...t,status:'completed',completedAt:now()},req);add('queue',{patientId:t.patientId,encounterId:t.encounterId,status:t.acuity==='emergency'?'emergency':'waiting-doctor',priority:t.acuity},req);return reply.code(201).send(x);});
app.post('/api/orders',async(req:any,reply)=>{const o=order.parse(req.body);const x=add('orders',{...o,status:'ordered',orderedAt:now()},req);if(o.category==='laboratory')add('laboratory',{orderId:x.id,patientId:o.patientId,status:'ordered',priority:o.priority,code:o.code,description:o.description},req); if(o.category==='imaging')add('imaging',{orderId:x.id,patientId:o.patientId,status:'ordered',priority:o.priority,code:o.code,description:o.description},req); if(o.category==='medication')add('pharmacy',{orderId:x.id,patientId:o.patientId,status:'prescribed',priority:o.priority,medicationCode:o.code,description:o.description},req); if(o.category==='procedure')add('procedures',{orderId:x.id,patientId:o.patientId,status:'ordered',code:o.code,description:o.description},req); return reply.code(201).send(x);});

app.post('/api/:module',async(req:any,reply)=>{const m=req.params.module as Mod;if(!store[m])throw Object.assign(new Error('Not found'), { statusCode: 404 });if(['patients','appointments','encounters','triage','orders'].includes(m))throw Object.assign(new Error('Use the validated endpoint for this resource'), { statusCode: 400 });return reply.code(201).send(add(m,generic.parse(req.body),req));});
app.patch('/api/:module/:id',async(req:any)=>{const m=req.params.module as Mod;if(!store[m])throw Object.assign(new Error('Not found'), { statusCode: 404 });const row=patch(m,req.params.id,generic.parse(req.body),req);if(!row)throw Object.assign(new Error('Not found'), { statusCode: 404 });return row;});
app.delete('/api/:module/:id',async(req:any)=>{const m=req.params.module as Mod;if(!store[m])throw Object.assign(new Error('Not found'), { statusCode: 404 });if(!remove(m,req.params.id,req))throw Object.assign(new Error('Not found'), { statusCode: 404 });return {ok:true};});

app.post('/api/workflows/:name',async(req:any,reply)=>{const b=(req.body||{}) as Row;const name=req.params.name as string;let results:Row[]=[];switch(name){case'checkin':results=[add('registration',{...b,status:'checked-in',checkedInAt:now()},req),add('queue',{patientId:b.patientId,appointmentId:b.appointmentId,status:'waiting-triage',priority:b.priority||'normal'},req)];break;case'triage':results=[add('triage',{...b,status:'completed',completedAt:now()},req),add('queue',{patientId:b.patientId,status:b.acuity==='emergency'?'emergency':'waiting-doctor',priority:b.acuity||'routine'},req)];break;case'lab_result':results=[add('laboratory',{...b,status:'verified',verifiedAt:now()},req),add('notifications',{patientId:b.patientId,channel:b.channel||'in-app',template:b.critical?'critical-lab':'result-ready',status:'queued'},req),add('tasks',{patientId:b.patientId,type:b.critical?'critical-result-review':'result-review',status:'open',priority:b.critical?'critical':'normal'},req)];break;case'dispense':results=[add('pharmacy',{...b,status:'dispensed',dispensedAt:now()},req),add('inventory',{itemId:b.itemId,quantityDelta:-(b.quantity||1),movement:'dispense'},req),add('notifications',{patientId:b.patientId,channel:'in-app',template:'prescription-ready',status:'queued'},req)];break;case'discharge':results=[add('inpatient',{...b,status:'discharged',dischargedAt:now()},req),add('follow-up',{patientId:b.patientId,status:'due',dueAt:b.followUpDate||null},req),add('tasks',{patientId:b.patientId,type:'follow-up-booking',status:'open'},req)];break;case'payment':results=[add('payments',{...b,status:'completed',paidAt:now()},req),add('notifications',{patientId:b.patientId,channel:b.channel||'in-app',template:'payment-receipt',status:'queued'},req)];break;case'referral':results=[add('referrals',{...b,status:'sent',sentAt:now()},req),add('tasks',{patientId:b.patientId,type:'referral-tracking',status:'open'},req)];break;default:throw Object.assign(new Error('Workflow not implemented'), { statusCode: 404 });}return reply.code(201).send({workflow:name,results,eventId:randomUUID()});});

// --- Production-oriented workflow helpers ---
app.get('/api/patients/:id/360',async(req:any,reply)=>{const p=store.patients.find(x=>x.id===req.params.id);if(!p)return reply.code(404).send({error:'Patient not found'});const related=(m:Mod)=>store[m].filter(x=>x.patientId===p.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));return {patient:p,timeline:[...related('encounters'),...related('orders'),...related('triage'),...related('laboratory'),...related('pharmacy'),...related('billing'),...related('payments'),...related('referrals'),...related('follow-up')].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),alerts:store.notifications.filter(x=>x.patientId===p.id&&x.status!=='resolved')}});
app.post('/api/queue/:id/transition',async(req:any,reply)=>{const q=store.queue.find(x=>x.id===req.params.id);if(!q)return reply.code(404).send({error:'Queue entry not found'});const next=String(req.body?.status||'');const allowed=['waiting','called','in-service','completed','cancelled','no-show','waiting-triage','waiting-doctor','emergency'];if(!allowed.includes(next))return reply.code(400).send({error:'Invalid queue status'});patch('queue',q.id,{status:next,calledAt:next==='called'?now():q.calledAt,completedAt:next==='completed'?now():q.completedAt},req);events.push({id:randomUUID(),type:'queue.transitioned',from:q.status,to:next,resourceId:q.id,at:now()});persist();return q});
app.post('/api/laboratory/:id/verify',async(req:any)=>{const x=patch('laboratory',req.params.id,{status:'verified',verifiedAt:now(),verifiedBy:actor(req),critical:Boolean(req.body?.critical),abnormalFlag:req.body?.abnormalFlag||null},req);if(!x)throw Object.assign(new Error('Lab record not found'),{statusCode:404});add('notifications',{patientId:x.patientId,channel:'in-app',template:x.critical?'critical-lab':'result-ready',status:'queued',payload:{laboratoryId:x.id}},req);add('tasks',{patientId:x.patientId,type:x.critical?'critical-result-review':'result-review',status:'open',priority:x.critical?'critical':'normal',referenceId:x.id},req);return x});
app.post('/api/pharmacy/:id/dispense',async(req:any)=>{const x=store.pharmacy.find(v=>v.id===req.params.id);if(!x)throw Object.assign(new Error('Pharmacy order not found'),{statusCode:404});const qty=Number(req.body?.quantity||1);if(qty<=0)throw Object.assign(new Error('Quantity must be positive'),{statusCode:400});patch('pharmacy',x.id,{status:'dispensed',quantity:qty,dispensedAt:now(),dispensedBy:actor(req)},req);add('inventory',{itemId:req.body?.itemId||x.medicationCode,quantityDelta:-qty,movement:'dispense',referenceId:x.id},req);add('notifications',{patientId:x.patientId,channel:'in-app',template:'prescription-ready',status:'queued'},req);return store.pharmacy.find(v=>v.id===x.id)});
app.post('/api/billing/:id/pay',async(req:any)=>{const inv=store.billing.find(v=>v.id===req.params.id);if(!inv)throw Object.assign(new Error('Invoice not found'),{statusCode:404});const amount=Number(req.body?.amount||0);if(amount<=0)throw Object.assign(new Error('Payment amount must be positive'),{statusCode:400});const payment=add('payments',{invoiceId:inv.id,patientId:inv.patientId,amount,method:req.body?.method||'cash',status:'completed',paidAt:now()},req);const total=Number(inv.total||0), paid=store.payments.filter(x=>x.invoiceId===inv.id&&x.status==='completed').reduce((s,x)=>s+Number(x.amount||0),0);patch('billing',inv.id,{paidAmount:paid,status:paid>=total?'paid':'partially-paid'},req);add('notifications',{patientId:inv.patientId,channel:'in-app',template:'payment-receipt',status:'queued',payload:{paymentId:payment.id}},req);return payment});
app.get('/api/search',async(req:any)=>{const q=String(req.query?.q||'').trim().toLowerCase();if(!q)return {patients:[],encounters:[],appointments:[]};const match=(r:Row)=>Object.values(r).some(v=>typeof v==='string'&&v.toLowerCase().includes(q));return {patients:store.patients.filter(match).slice(0,20),encounters:store.encounters.filter(match).slice(0,20),appointments:store.appointments.filter(match).slice(0,20)}});



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
  const p=store.patients.find(x=>x.id===req.params.id && x.organizationId===org(req));
  if(!p) return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Patient not found'}]});
  return fhirPatient(p);
});
app.get('/api/fhir/Patient',async(req:any)=>{
  const q=String(req.query?.identifier||req.query?.name||'').toLowerCase();
  const rows=store.patients.filter(x=>x.organizationId===org(req)).filter(x=>!q || `${x.patientNumber} ${x.firstName} ${x.lastName}`.toLowerCase().includes(q)).slice(0,100);
  return {resourceType:'Bundle',type:'searchset',total:rows.length,entry:rows.map(x=>({fullUrl:`urn:uuid:${x.id}`,resource:fhirPatient(x)}))};
});

app.post('/api/clinical/observations',async(req:any,reply)=>{
  const body=z.object({patientId:z.string(),encounterId:z.string().optional(),code:z.string(),display:z.string().optional(),valueNumeric:z.number().optional(),valueText:z.string().optional(),unit:z.string().optional()}).parse(req.body);
  const x=add('clinical-notes',{kind:'observation',...body,recordedAt:now()},req);
  return reply.code(201).send(x);
});
app.post('/api/clinical/notes/:encounterId/sign',async(req:any,reply)=>{
  const note=store['clinical-notes'].find(x=>x.encounterId===req.params.encounterId && x.organizationId===org(req));
  if(!note) return reply.code(404).send({error:'Clinical note not found'});
  if(note.signedAt) return reply.code(409).send({error:'Clinical note is already signed'});
  const updated=patch('clinical-notes',note.id,{signedAt:now(),signedBy:actor(req),status:'signed'},req);
  audit.push({id:randomUUID(),action:'CLINICAL_NOTE_SIGNED',resourceId:note.id,patientId:note.patientId,actorId:actor(req),at:now()}); persist();
  return updated;
});
app.post('/api/appointments/:id/check-in',async(req:any,reply)=>{
  const a=store.appointments.find(x=>x.id===req.params.id && x.organizationId===org(req));
  if(!a) return reply.code(404).send({error:'Appointment not found'});
  patch('appointments',a.id,{status:'arrived',arrivedAt:now()},req);
  const q=add('queue',{patientId:a.patientId,appointmentId:a.id,facilityId:a.facilityId,status:'waiting-triage',priority:'normal'},req);
  add('registration',{patientId:a.patientId,appointmentId:a.id,status:'checked-in',checkedInAt:now()},req);
  return {appointment:a,queue:q};
});
app.post('/api/laboratory/:id/release',async(req:any,reply)=>{
  const x=store.laboratory.find(v=>v.id===req.params.id && v.organizationId===org(req));
  if(!x) return reply.code(404).send({error:'Lab record not found'});
  if(x.status!=='verified') return reply.code(409).send({error:'Result must be verified before release'});
  const released=patch('laboratory',x.id,{status:'released',releasedAt:now(),releasedBy:actor(req)},req);
  add('notifications',{patientId:x.patientId,channel:'in-app',template:'result-ready',status:'queued',payload:{laboratoryId:x.id}},req);
  return released;
});
app.post('/api/tasks/:id/complete',async(req:any,reply)=>{
  const x=store.tasks.find(v=>v.id===req.params.id && v.organizationId===org(req));
  if(!x) return reply.code(404).send({error:'Task not found'});
  return patch('tasks',x.id,{status:'completed',completedAt:now(),completedBy:actor(req),resolution:req.body?.resolution||null},req);
});

app.setErrorHandler((err:any,_req,reply)=>{app.log.error(err);reply.code(err.statusCode||500).send({error:err.message||'Request failed',issues:err.issues});});
await app.listen({port:Number(process.env.PORT||4000),host:'0.0.0.0'});

