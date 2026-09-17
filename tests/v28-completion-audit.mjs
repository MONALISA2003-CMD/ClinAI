import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const api=fs.readFileSync(path.join(root,'services/api/src/main.ts'),'utf8');
const ai=fs.readFileSync(path.join(root,'services/api/src/ai/ai-orchestrator.ts'),'utf8');
const providers=fs.readFileSync(path.join(root,'services/api/src/ai/ai-providers.ts'),'utf8');
const ctx=fs.readFileSync(path.join(root,'services/api/src/intelligence/clinicalContext.ts'),'utf8');
const ent=fs.readFileSync(path.join(root,'services/api/src/intelligence/enterpriseIntelligence.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'database/migrations/023-clinai-intelligence-completion.sql'),'utf8');
const page=fs.readFileSync(path.join(root,'apps/web/app/page.tsx'),'utf8');
const required=[
 ['clinical context integration',api.includes('buildClinicalContext')||ai.includes('buildClinicalContext')],
 ['capability policy enforcement',ai.includes('AI_CAPABILITY_POLICY_DENIED')],
 ['AI lifecycle storage',migration.includes('ai_model_lifecycle_events')&&migration.includes('ai_incidents')],
 ['capability evaluations',api.includes('/api/intelligence/capability-evaluations')],
 ['clinical measure execution',api.includes('/api/intelligence/measures')&&ent.includes('calculateClinicalMeasures')],
 ['care gap materialization',api.includes('/api/intelligence/care-gaps/materialize')],
 ['SMART configuration',api.includes('/.well-known/smart-configuration')],
 ['SMART authorization + PKCE',api.includes('/api/smart/authorize')&&api.includes('code_challenge')&&api.includes('code_verifier')],
 ['SMART app registration',api.includes('/api/smart/apps')],
 ['CDS Hooks order-select',api.includes("id:'order-select'")],
 ['multimodal attachment transport',ai.includes('attachments')&&providers.includes('input_audio')&&providers.includes('image_url')],
 ['intro Uganda WhatsApp',page.includes('https://wa.me/256703953711')],
 ['intro feedback WhatsApp',page.includes('https://wa.me/19138992840?text=Hello%20MONALISA')],
 ['footer Uganda WhatsApp',page.includes('>+256 703 953 711 · WhatsApp</a>')],
];
for(const [name,ok] of required) if(!ok) throw new Error(`Missing: ${name}`);
if(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(migration.replace(/--.*$/gm,''))) throw new Error('Destructive SQL detected in V28 migration');
console.log(JSON.stringify({ok:true,checks:required.length,aiCapabilities:(ent.match(/capabilityId:/g)||[]).length,cdsHooks:(api.match(/id:'[^']+'/g)||[]).filter(x=>x.includes("id:'patient-view'")||x.includes("id:'encounter-start'")||x.includes("id:'order-select'")||x.includes("id:'order-sign'")||x.includes("id:'encounter-discharge'")).length},null,2));
