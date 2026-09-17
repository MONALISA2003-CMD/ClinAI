import fs from 'node:fs';
import assert from 'node:assert/strict';

const page = fs.readFileSync('apps/web/app/page.tsx','utf8');
const api = fs.readFileSync('services/api/src/main.ts','utf8');
const migration = fs.readFileSync('database/migrations/022-clinai-cross-module-intelligence-governance.sql','utf8');

const groupMatch = page.match(/const groups:any\[\]=\[([\s\S]*?)\n\];/);
assert(groupMatch,'Module groups must exist');
const moduleMatches=[...groupMatch[1].matchAll(/\['[^']+',\[([^\]]*)\]\]/g)];
const modules=[];
for(const m of moduleMatches){ for(const token of m[1].matchAll(/['"]([^'"]+)['"]/g)) modules.push(token[1]); }
const unique=[...new Set(modules)];
assert.equal(unique.length,modules.length,`Duplicate module IDs: ${modules.filter((x,i)=>modules.indexOf(x)!==i).join(', ')}`);
assert(unique.length>=70,`Expected full module catalogue, found ${unique.length}`);

const catalog=JSON.parse(fs.readFileSync('packages/module-contracts/contracts.json','utf8'));
assert(Array.isArray(catalog.modules),'Central module contract catalog missing');
const contractIds=new Set(catalog.modules.map(x=>x.id));
const contractMissing=unique.filter(m=>!contractIds.has(m));
assert.deepEqual(contractMissing,[],`Modules missing from central contract catalog: ${contractMissing.join(', ')}`);
assert(catalog.modules.every(x=>x.backend?.endpoint),'Every module contract must declare a backend read endpoint');
assert(catalog.modules.every(x=>Array.isArray(x.permissions?.read)),'Every module contract must declare read permissions');

const intelligenceRoutes=['/api/intelligence/overview','/api/intelligence/patient/:patientId','/api/intelligence/velocity','/api/intelligence/care-gaps','/api/intelligence/risk','/api/intelligence/value','/api/intelligence/governance','/api/intelligence/security-events','/api/cds-services','/api/cds-services/:serviceId'];
for(const route of intelligenceRoutes) assert(api.includes(route),`Missing backend route ${route}`);

const requiredIntelligenceModules=['patient-360-intelligence','clinical-velocity','value-based-care','ai-risk-management','ai-security-management','ai-governance'];
for(const m of requiredIntelligenceModules) assert(unique.includes(m),`Missing intelligence module ${m}`);

const journeyBlock=page.match(/const journey:any\[\]=\[([\s\S]*?)\];/);
assert(journeyBlock,'Patient journey definition missing');
const journeyModules=[...journeyBlock[1].matchAll(/,\s*['"]([^'"]+)['"]\]/g)].map(x=>x[1]);
assert(journeyModules.length>=20,`Journey coverage unexpectedly low: ${journeyModules.length}`);
const missingJourney=journeyModules.filter(m=>!unique.includes(m));
assert.deepEqual(missingJourney,[],`Journey points to missing modules: ${missingJourney.join(', ')}`);

const migrationSql=migration.replace(/--.*$/gm,'');
const forbidden=/(DROP\s+TABLE|TRUNCATE\s+TABLE|TRUNCATE\b|DELETE\s+FROM\s+(?:public\.)?(?:patients|encounters|clinical_orders|observations|organizations|users)\b)/i;
assert(!forbidden.test(migrationSql),'Migration contains destructive SQL');
assert(/CREATE TABLE IF NOT EXISTS ai_capabilities/i.test(migration));
assert(/CREATE TABLE IF NOT EXISTS ai_risk_assessments/i.test(migration));
assert(/CREATE TABLE IF NOT EXISTS ai_security_events/i.test(migration));
assert(/CREATE TABLE IF NOT EXISTS care_gap_snapshots/i.test(migration));
assert(/CREATE TABLE IF NOT EXISTS value_measure_definitions/i.test(migration));

const audit={modules:unique.length,readContracts:readKeys.length,createContracts:createKeys.length,readOnly:readOnly.length,journeyStages:journeyModules.length,intelligenceModules:requiredIntelligenceModules.length,backendIntelligenceRoutes:intelligenceRoutes.length,additiveMigration:true};
console.log(JSON.stringify({ok:true,audit},null,2));
