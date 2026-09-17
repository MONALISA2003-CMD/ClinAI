import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'packages/module-contracts/contracts.json'),'utf8'));
const source=fs.readFileSync(path.join(root,'apps/web/app/page.tsx'),'utf8');
const api=fs.readFileSync(path.join(root,'services/api/src/main.ts'),'utf8');
const ids=catalog.modules.map(x=>x.id); const errors=[];
if(new Set(ids).size!==ids.length) errors.push('Duplicate module contract IDs');
for(const c of catalog.modules){
 for(const k of ['identity','frontendRoute','backend','databaseSource','fields','requiredFields','relationships','permissions','actions','validation','emptyState','events','intelligenceConnections']) if(c[k]===undefined) errors.push(`${c.id}: missing ${k}`);
 if(!c.backend?.endpoint) errors.push(`${c.id}: missing backend endpoint`);
 if(!c.databaseSource) errors.push(`${c.id}: missing database source`);
 if(!Array.isArray(c.intelligenceConnections)||!c.intelligenceConnections.length) errors.push(`${c.id}: missing intelligence connection`);
 if(c.events?.required!==true) errors.push(`${c.id}: event connection not required`);
 if(!source.includes('CONTRACT_BY_ID')) errors.push('Frontend is not using central contract registry');
}
const advertised=[...source.matchAll(/\['(?:CARE|CLINICAL|FINANCE|SUPPLY|PATIENT|PUBLIC HEALTH|OPERATIONS|INTELLIGENCE|TRUST & CONNECTIONS)',\[(.*?)\]\]/gs)].flatMap(m=>[...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]));
for(const id of advertised) if(!ids.includes(id)) errors.push(`Advertised frontend module missing contract: ${id}`);
if(source.includes('fields:Record<string,Field')||source.includes("fields[module]||[{key:'name'")) errors.push('Frontend still contains generic field fallback');
if(api.includes("app.get('/api/:module'")||api.includes("app.post('/api/:module'")||api.includes("app.patch('/api/:module'")||api.includes("app.delete('/api/:module'")) errors.push('Generic /api/:module route remains');
if(!api.includes("app.get('/api/contracts/modules/:module'")) errors.push('Contract read route missing');
if(!api.includes("app.post('/api/contracts/modules/:module'")) errors.push('Contract create route missing');
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Phase 2 module contract audit passed: ${ids.length} contracts; ${advertised.length} advertised modules covered.`);

// Optional deployment gate. Set CLINAI_BASE_URL and CLINAI_MODULE_TOKEN in CI/CD.
const base=process.env.CLINAI_BASE_URL; const token=process.env.CLINAI_MODULE_TOKEN;
if(base && token){
 const failures=[];
 for(const c of catalog.modules){
  const url=new URL(c.backend.endpoint,base).toString();
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
  if(r.status===404) failures.push(`${c.id}: ${url} returned 404`);
 }
 if(failures.length){console.error('DEPLOYMENT GATE FAILED\n'+failures.join('\n'));process.exit(2)}
 console.log('Runtime module endpoint gate passed: no advertised module returned 404.');
}
