'use client';
import {useEffect,useMemo,useState} from 'react';

const API=(process.env.NEXT_PUBLIC_API_URL||'https://clinai-api.onrender.com').replace(/\/$/,'');
type Row=Record<string,any>;

type Field={key:string;label:string;type?:string;placeholder?:string;options?:string[]};
const groups:any=[
 ['CARE',['patients','appointments','registration','queue','triage','encounters','clinical-notes','diagnoses','orders','care-plans','referrals','follow-up']],
 ['CLINICAL',['laboratory','imaging','pharmacy','nursing','emergency','inpatient','beds','surgery','maternity','pediatrics','immunization','chronic-care']],
 ['FINANCE',['billing','payments','insurance','claims','accounting']],
 ['SUPPLY',['inventory','procurement','suppliers']],
 ['PATIENT',['patient-portal','telemedicine','remote-monitoring','notifications','documents']],
 ['INTELLIGENCE',['ai','analytics','population-health']],
 ['PLATFORM',['staff','facilities','tasks','workflows','interoperability','trust','audit','settings']]
];
const journey:any=[['Registration','registration'],['Check-in & Queue','queue'],['Triage & Vitals','triage'],['Encounter','encounters'],['Orders','orders'],['Lab / Imaging','laboratory'],['Pharmacy','pharmacy'],['Billing','billing'],['Discharge','follow-up'],['Follow-up','follow-up']];
const pretty=(x:string)=>x.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());

const fields:Record<string,Field[]>= {
 patients:[{key:'firstName',label:'First name'},{key:'lastName',label:'Last name'},{key:'phone',label:'Phone'}],
 appointments:[{key:'patientId',label:'Patient ID'},{key:'startAt',label:'Start date/time',type:'datetime-local'}],
 registration:[{key:'patientId',label:'Patient ID'},{key:'status',label:'Status',options:['registered','checked-in','completed']}],
 queue:[{key:'patientId',label:'Patient ID'},{key:'priority',label:'Priority',options:['normal','routine','urgent','emergency','stat']}],
 triage:[{key:'patientId',label:'Patient ID'},{key:'chiefComplaint',label:'Chief complaint'},{key:'temperature',label:'Temperature'},{key:'systolic',label:'Systolic BP'},{key:'diastolic',label:'Diastolic BP'},{key:'acuity',label:'Acuity',options:['routine','urgent','emergency']}],
 encounters:[{key:'patientId',label:'Patient ID'},{key:'reason',label:'Reason'}],
 'clinical-notes':[{key:'patientId',label:'Patient ID'},{key:'encounterId',label:'Encounter ID'},{key:'noteType',label:'Note type'},{key:'assessment',label:'Assessment'},{key:'plan',label:'Plan'}],
 diagnoses:[{key:'patientId',label:'Patient ID'},{key:'code',label:'Diagnosis code'},{key:'description',label:'Description'}],
 orders:[{key:'patientId',label:'Patient ID'},{key:'code',label:'Order code'},{key:'description',label:'Description'},{key:'category',label:'Category',options:['laboratory','imaging','medication','procedure']},{key:'priority',label:'Priority',options:['routine','urgent','stat']}],
 laboratory:[{key:'patientId',label:'Patient ID'},{key:'code',label:'Test code'},{key:'name',label:'Test name'},{key:'priority',label:'Priority',options:['routine','urgent','stat']}],
 imaging:[{key:'patientId',label:'Patient ID'},{key:'modality',label:'Modality'},{key:'study',label:'Study'},{key:'priority',label:'Priority',options:['routine','urgent','stat']}],
 pharmacy:[{key:'patientId',label:'Patient ID'},{key:'medicationCode',label:'Medication code'},{key:'medicationName',label:'Medication name'},{key:'quantity',label:'Quantity'}],
 nursing:[{key:'patientId',label:'Patient ID'},{key:'task',label:'Nursing task'},{key:'priority',label:'Priority',options:['normal','urgent','stat']}],
 emergency:[{key:'patientId',label:'Patient ID'},{key:'chiefComplaint',label:'Chief complaint'},{key:'acuity',label:'Acuity',options:['urgent','emergency']}],
 inpatient:[{key:'patientId',label:'Patient ID'},{key:'ward',label:'Ward'},{key:'bed',label:'Bed'}],
 beds:[{key:'ward',label:'Ward'},{key:'bedNumber',label:'Bed number'},{key:'status',label:'Status',options:['available','occupied','cleaning','blocked']}],
 surgery:[{key:'patientId',label:'Patient ID'},{key:'procedure',label:'Procedure'},{key:'scheduledAt',label:'Scheduled date/time',type:'datetime-local'}],
 maternity:[{key:'patientId',label:'Patient ID'},{key:'event',label:'Maternity event'},{key:'status',label:'Status'}],
 pediatrics:[{key:'patientId',label:'Patient ID'},{key:'assessment',label:'Assessment'},{key:'weight',label:'Weight'}],
 immunization:[{key:'patientId',label:'Patient ID'},{key:'vaccine',label:'Vaccine'},{key:'dose',label:'Dose'}],
 'chronic-care':[{key:'patientId',label:'Patient ID'},{key:'condition',label:'Condition'},{key:'status',label:'Status'}],
 'care-plans':[{key:'patientId',label:'Patient ID'},{key:'problem',label:'Care problem'},{key:'goal',label:'Goal'},{key:'status',label:'Status'}],
 referrals:[{key:'patientId',label:'Patient ID'},{key:'reason',label:'Referral reason'},{key:'destination',label:'Destination'}],
 'follow-up':[{key:'patientId',label:'Patient ID'},{key:'reason',label:'Follow-up reason'},{key:'dueAt',label:'Due date/time',type:'datetime-local'}],
 billing:[{key:'patientId',label:'Patient ID'},{key:'description',label:'Charge description'},{key:'total',label:'Total'}],
 payments:[{key:'invoiceId',label:'Invoice ID'},{key:'amount',label:'Amount'},{key:'method',label:'Method',options:['cash','mobile-money','card','bank']}],
 insurance:[{key:'patientId',label:'Patient ID'},{key:'provider',label:'Provider'},{key:'policyNumber',label:'Policy number'}],
 claims:[{key:'patientId',label:'Patient ID'},{key:'claimNumber',label:'Claim number'},{key:'status',label:'Status',options:['draft','submitted','approved','rejected']}],
 accounting:[{key:'description',label:'Entry description'},{key:'amount',label:'Amount'},{key:'type',label:'Type',options:['income','expense','adjustment']}],
 inventory:[{key:'name',label:'Item name'},{key:'quantity',label:'Quantity'},{key:'unit',label:'Unit'}],
 procurement:[{key:'supplier',label:'Supplier'},{key:'description',label:'Order description'},{key:'quantity',label:'Quantity'}],
 suppliers:[{key:'name',label:'Supplier name'},{key:'phone',label:'Phone'},{key:'email',label:'Email'}],
 'patient-portal':[{key:'patientId',label:'Patient ID'},{key:'feature',label:'Portal feature'},{key:'status',label:'Status'}],
 telemedicine:[{key:'patientId',label:'Patient ID'},{key:'scheduledAt',label:'Scheduled date/time',type:'datetime-local'},{key:'meetingUrl',label:'Meeting URL'}],
 'remote-monitoring':[{key:'patientId',label:'Patient ID'},{key:'device',label:'Device'},{key:'reading',label:'Reading'}],
 notifications:[{key:'patientId',label:'Patient ID'},{key:'channel',label:'Channel',options:['in-app','sms','email','whatsapp']},{key:'message',label:'Message'}],
 documents:[{key:'patientId',label:'Patient ID'},{key:'name',label:'Document name'},{key:'type',label:'Document type'}],
 ai:[{key:'patientId',label:'Patient ID'},{key:'task',label:'AI task'},{key:'prompt',label:'Prompt'}],
 analytics:[{key:'name',label:'Metric name'},{key:'value',label:'Value'},{key:'period',label:'Period'}],
 'population-health':[{key:'name',label:'Population metric'},{key:'value',label:'Value'},{key:'period',label:'Period'}],
 staff:[{key:'name',label:'Staff name'},{key:'role',label:'Role'},{key:'phone',label:'Phone'}],
 facilities:[{key:'name',label:'Facility name'},{key:'type',label:'Facility type'},{key:'status',label:'Status'}],
 tasks:[{key:'title',label:'Task title'},{key:'priority',label:'Priority',options:['normal','urgent','critical']},{key:'status',label:'Status',options:['open','in-progress','completed']}],
 workflows:[{key:'name',label:'Workflow name'},{key:'trigger',label:'Trigger'},{key:'status',label:'Status'}],
 interoperability:[{key:'system',label:'Connected system'},{key:'standard',label:'Standard',options:['FHIR','HL7v2','DICOM','DHIS2']},{key:'status',label:'Status'}],
 trust:[{key:'control',label:'Control'},{key:'status',label:'Status'}],
 audit:[{key:'action',label:'Action'},{key:'entityType',label:'Entity type'},{key:'entityId',label:'Entity ID'}],
 settings:[{key:'name',label:'Setting name'},{key:'value',label:'Value'}],
 'command-center':[{key:'title',label:'Command item'},{key:'status',label:'Status'},{key:'priority',label:'Priority',options:['normal','urgent','critical']}]
};

export default function Home(){
 const [token,setToken]=useState(''),[module,setModule]=useState('patients'),[rows,setRows]=useState<Row[]>([]),[dash,setDash]=useState<Row>({}),[status,setStatus]=useState('Connecting'),[error,setError]=useState('');
 async function login(){try{const r=await fetch(`${API}/api/auth/demo`,{method:'POST'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Login failed');setToken(d.token)}catch(e:any){setError(e.message);setStatus('Offline')}}
 async function load(){if(!token)return;setStatus('Loading');setError('');try{const r=await fetch(`${API}/api/${module}`,{headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(!r.ok)throw new Error(d.error||`Unable to load ${pretty(module)}`);setRows(d.data||[]);setStatus('Ready')}catch(e:any){setRows([]);setError(e.message);setStatus('Error')}}
 async function refreshDash(){if(!token)return;try{const r=await fetch(`${API}/api/dashboard`,{headers:{Authorization:`Bearer ${token}`}});if(r.ok)setDash(await r.json())}catch{}}
 useEffect(()=>{login()},[]);useEffect(()=>{if(token){load();refreshDash()}},[token,module]);
 const title=module==='command-center'?'Command Center':pretty(module);
 return <main><aside><div className="brand"><b>ClinAI</b><span>Connected Healthcare OS</span></div>{groups.map(([g,items]:any)=><section key={g}><small>{g}</small>{items.map((x:string)=><button key={x} className={module===x?'active':''} onClick={()=>{setModule(x);setError('')}}>{pretty(x)}</button>)}</section>)}</aside><div className="content"><header><div><small>CLINAI WORKSPACE</small><h1>{title}</h1><p>Connected care, clinical operations and intelligence in one workspace.</p></div><div className="status">● {status}</div></header><div className="metrics">{[['Patients',dash.patients],['Appointments',dash.appointments],['Waiting',dash.waiting],['Critical labs',dash.criticalLabs],['Open tasks',dash.openTasks],['Unpaid',dash.unpaid]].map(([n,v])=><div className="metric" key={String(n)}><strong>{v??0}</strong><span>{n}</span></div>)}</div>{error&&<div className="error">{error}</div>}<div className="grid"><section className="panel"><div className="panelhead"><div><small>WORKSPACE</small><h2>{title}</h2></div><button onClick={()=>{load();refreshDash()}}>Refresh</button></div><Action module={module} token={token} done={()=>{load();refreshDash()}}/><div className="list">{rows.length?rows.map(r=><article key={r.id}><div><b>{r.firstName?`${r.firstName} ${r.lastName}`:r.name||r.title||r.description||r.task||r.code||r.template||r.status||'Record'}</b><span>{r.patientNumber||r.phone||r.priority||r.status||r.createdAt||r.updatedAt||''}</span></div><em>{r.status||'active'}</em></article>):<div className="empty">No records yet. Create the first record above.</div>}</div></section><section className="panel"><div className="panelhead"><div><small>CONNECTED CARE</small><h2>Clinical journey</h2></div></div>{journey.map(([x,m]:any,i:number)=><button className="journey" key={x} onClick={()=>setModule(m)}><i>{i+1}</i><span>{x}</span><em>{module===m?'open':'connected'}</em></button>)}</section></div></div></main>
}

function Action({module,token,done}:{module:string;token:string;done:()=>void}){const [d,setD]=useState<Row>({}),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');const fs=fields[module]||[{key:'name',label:'Name'},{key:'description',label:'Description'},{key:'status',label:'Status'}];
 async function submit(){setBusy(true);setMsg('');try{let body={...d};let url=`${API}/api/${module}`;if(module==='appointments'&&body.startAt)body.startAt=new Date(body.startAt).toISOString();if(module==='follow-up'&&body.dueAt)body.dueAt=new Date(body.dueAt).toISOString();if(module==='triage'){body.temperature=body.temperature?Number(body.temperature):undefined;body.systolic=body.systolic?Number(body.systolic):undefined;body.diastolic=body.diastolic?Number(body.diastolic):undefined;}if(module==='queue'){body.status=body.status||'waiting'}if(module==='orders'){body.category=body.category||'laboratory';body.code=body.code||'GENERAL';body.priority=body.priority||'routine'}const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});const out=await r.json();if(!r.ok)throw new Error(out.error||'Request failed');setD({});setMsg('Saved successfully');done()}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 return <div className="quick">{fs.map(f=>f.options?<select key={f.key} value={d[f.key]||f.options[0]} onChange={e=>setD({...d,[f.key]:e.target.value})}><option value="">{f.label}</option>{f.options.map(o=><option key={o}>{o}</option>)}</select>:<input key={f.key} type={f.type||'text'} placeholder={f.placeholder||f.label} value={d[f.key]||''} onChange={e=>setD({...d,[f.key]:e.target.value})}/>)}<button disabled={busy||!token} onClick={submit}>{busy?'Saving…':'Create'}</button>{msg&&<span className="formmsg">{msg}</span>}</div>
}
