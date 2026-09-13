const base=process.env.API_URL||'http://localhost:4000';
const auth=await fetch(`${base}/api/auth/demo`,{method:'POST'}); if(!auth.ok) throw new Error('auth failed'); const {token}=await auth.json();
const h={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:h,body:JSON.stringify(body)});if(!r.ok)throw new Error(`${path}: ${await r.text()}`);return r.json()};
const patient=await post('/api/patients',{firstName:'Smoke',lastName:'Test',phone:`+256${Date.now()}`});
const encounter=await post('/api/encounters',{patientId:patient.id,reason:'Smoke test'});
const order=await post('/api/orders',{patientId:patient.id,encounterId:encounter.id,category:'laboratory',code:'CBC'});
const dashboard=await (await fetch(base+'/api/dashboard',{headers:h})).json();
console.log(JSON.stringify({ok:true,patient:patient.id,encounter:encounter.id,order:order.id,dashboard},null,2));
