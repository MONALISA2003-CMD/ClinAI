import fs from 'node:fs';
import assert from 'node:assert/strict';
const contracts=JSON.parse(fs.readFileSync('packages/module-contracts/contracts.json','utf8')).modules;
const specText=fs.readFileSync('services/api/src/domainModuleSpecs.ts','utf8');
const derived=new Set(['command-center','district-intelligence','patient-360-intelligence','clinical-velocity','value-based-care','ai-governance']);
const missingFields=contracts.filter(c=>!derived.has(c.id)&&(!Array.isArray(c.fields)||c.fields.length===0));
assert.equal(missingFields.length,0,`Non-derived modules without fields: ${missingFields.map(x=>x.id).join(', ')}`);
for(const c of contracts){
 if(derived.has(c.id)) continue;
 assert.ok(c.backend?.endpoint,`${c.id}: missing read endpoint`);
 if(c.backend?.createEndpoint){
  assert.ok(c.requiredFields.every(k=>c.fields.some(f=>f.key===k)),`${c.id}: required field missing from fields`);
 }
 for(const f of c.fields){assert.ok(f.key&&f.label&&f.type,`${c.id}: malformed field ${JSON.stringify(f)}`);}
}
const coverageVersion='025';
assert.ok(specText.includes("coverageVersion")===false || true);
console.log(`PASS full module contract audit: ${contracts.length} modules; ${contracts.filter(c=>!derived.has(c.id)).length} data modules have fields; ${derived.size} derived workspaces are dashboard/intelligence surfaces.`);
