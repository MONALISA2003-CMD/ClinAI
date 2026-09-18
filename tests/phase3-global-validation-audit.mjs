import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'packages/module-contracts/contracts.json'),'utf8'));
const source=fs.readFileSync(path.join(root,'packages/domain/validation/index.ts'),'utf8');
const api=fs.readFileSync(path.join(root,'services/api/src/main.ts'),'utf8');
const web=fs.readFileSync(path.join(root,'apps/web/app/page.tsx'),'utf8');
const errors=[];
const createContracts=catalog.modules.filter(c=>c.backend?.createEndpoint);
for(const c of createContracts){
  const keys=new Set(c.fields.map(f=>f.key));
  const requiredKeys=new Set(c.requiredFields||[]);
  for(const f of c.fields){
    if(!f.type) errors.push(`${c.id}.${f.key}: missing type`);
    if(requiredKeys.has(f.key) && !f.required) errors.push(`${c.id}.${f.key}: required field is not marked required`);
    if(f.key.endsWith('Id') && f.format!=='uuid') errors.push(`${c.id}.${f.key}: ID field is not UUID constrained`);
    if(f.key.endsWith('Id') && !c.relationships.some(r=>r.field===f.key) && !['operationId','nationalId','sourceId','targetId','providerId','policyId','invoiceId','referenceId','supplierId'].includes(f.key)) errors.push(`${c.id}.${f.key}: relationship contract missing`);
  }
  for(const k of c.requiredFields) if(!keys.has(k)) errors.push(`${c.id}: required field ${k} not declared`);
  if(c.validation?.backendIndependent!==true) errors.push(`${c.id}: backendIndependent missing`);
  if(c.validation?.validateDates!==true) errors.push(`${c.id}: date validation marker missing`);
  if(c.validation?.validateRelationships!==true) errors.push(`${c.id}: relationship validation marker missing`);
  if(c.validation?.permissionAware!==true) errors.push(`${c.id}: permission validation marker missing`);
}
for(const marker of ['validateRecord','isUuid','isValidDate','rejectBlankStrings','WORKFLOW_VALIDATION_CONTRACTS']) if(!source.includes(marker)) errors.push(`Validation framework missing ${marker}`);
for(const marker of ['contractForRequest','validateContractRelationships','MODULE_PERMISSION_REQUIRED','Organization is assigned by the authorized workspace']) if(!api.includes(marker)) errors.push(`Backend validation boundary missing ${marker}`);
for(const marker of ['validateRecord(contract,next)','formReady','aria-invalid','required={f.required}']) if(!web.includes(marker)) errors.push(`Frontend validation control missing ${marker}`);
if(web.includes('disabled={busy||!token} onClick={submit}')) errors.push('Create button still permits submission without validation readiness');
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Phase 3 global validation audit passed: ${createContracts.length} create-capable contracts; ${createContracts.reduce((n,c)=>n+c.fields.length,0)} user-entered fields governed.`);
