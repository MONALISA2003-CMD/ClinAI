const base=process.env.API_URL||'http://localhost:4000';
const auth=await fetch(base+'/api/auth/demo',{method:'POST'});if(!auth.ok)throw Error('auth failed');const {token}=await auth.json();const h={Authorization:`Bearer ${token}`,'content-type':'application/json'};
const create=await fetch(base+'/api/patients',{method:'POST',headers:h,body:JSON.stringify({firstName:'Test',lastName:'Patient',phone:'256700000001'})});if(!create.ok)throw Error('patient creation failed');const p=await create.json();
const ap=await fetch(base+'/api/appointments',{method:'POST',headers:h,body:JSON.stringify({patientId:p.id,startAt:new Date(Date.now()+3600000).toISOString(),durationMinutes:30})});if(!ap.ok)throw Error('appointment creation failed');
const e=await fetch(base+'/api/encounters',{method:'POST',headers:h,body:JSON.stringify({patientId:p.id,appointmentId:(await ap.json()).id,reason:'Routine review'})});if(!e.ok)throw Error('encounter creation failed');
const t=await fetch(base+'/api/triage',{method:'POST',headers:h,body:JSON.stringify({patientId:p.id,chiefComplaint:'Review',acuity:'routine',temperature:36.8,systolic:120,diastolic:80})});if(!t.ok)throw Error('triage failed');
const o=await fetch(base+'/api/orders',{method:'POST',headers:h,body:JSON.stringify({patientId:p.id,category:'laboratory',code:'CBC',description:'Complete blood count'})});if(!o.ok)throw Error('order failed');
console.log('ClinAI contract smoke test passed:',p.patientNumber);
