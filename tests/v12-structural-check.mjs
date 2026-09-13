import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const api=fs.readFileSync(root+'services/api/src/main.ts','utf8');
const migration=fs.readFileSync(root+'database/migrations-012-public-health-response-one-health.sql','utf8');
for (const x of ['public_health_investigations','public_health_contacts','public_health_response_tasks','public_health_alerts','mortality_surveillance_records']) if(!migration.includes(x)) throw new Error('Missing '+x);
for (const x of ['/api/public-health/investigations','/api/public-health/response-tasks','/api/public-health/alerts','/api/mortality-surveillance','/api/public-health/dashboard']) if(!api.includes(x)) throw new Error('Missing route '+x);
if(!api.includes('requiresHumanApproval')) throw new Error('Human approval governance missing');
if(!api.includes('One Health')) throw new Error('One Health marker missing');
console.log('ClinAI V12 structural check passed');
