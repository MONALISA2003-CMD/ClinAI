import fs from 'node:fs';
const page=fs.readFileSync('apps/web/app/page.tsx','utf8');
const css=fs.readFileSync('apps/web/app/globals.css','utf8');
const api=fs.readFileSync('services/api/src/main.ts','utf8');
const ai=fs.readFileSync('services/api/src/ai/ai-orchestrator.ts','utf8');
const checks=[
 ['public introduction exists', page.includes('PublicIntroduction')],
 ['intro requires deliberate entry', page.includes('ENTER CLINAI') && page.includes('ABOUT CLINAI')],
 ['public test data notice', page.includes('PUBLIC TESTING VERSION') && page.includes('synthetic test data')],
 ['about ClinAI direction', page.includes('ABOUT CLINAI') && page.includes('Healthcare information should move with the patient.')],
 ['how ClinAI works', page.includes('HOW CLINAI WORKS') && page.includes('Connected care')],
 ['direct WhatsApp feedback', page.includes('https://wa.me/19138992840') && page.includes('GIVE FEEDBACK')],
 ['Monalisa attribution', page.includes('MONALISA TECH SOLUTIONS')],
 ['no fake data seeding in web', !/fake patient|demo patient|sample patient/i.test(page)],
 ['public AI endpoint', api.includes("'/api/public/ai-assist'") && ai.includes('publicMode: true')],
 ['public AI status endpoint', api.includes("'/api/public/ai-status'")],
 ['public AI feedback endpoint', api.includes("'/api/public/ai-feedback'")],
 ['public AI synthetic patient boundary', ai.includes('testPatientNumber') && ai.includes('is_test_data=true') && ai.includes('publicTestOrganizationId')],
 ['public AI no clinical writes', ai.includes('allowCodeExecution: false') && ai.includes('publicMode: true')],
 ['public AI safe tools only', ai.includes("t.name === 'calculate' || t.name === 'analyze_dataset'")],
 ['public AI rate limiting', ai.includes('PUBLIC_AI_RATE_LIMIT') && ai.includes('enforcePublicAIRate')],
 ['public AI multimodal testing UI', page.includes('Add synthetic media') && page.includes('accept="image/*,audio/*"')],
 ['public AI modes', page.includes("['quick','Quick'") && page.includes("['research','Research'")],
 ['public AI languages', page.includes('Kiswahili') && page.includes('Kinyarwanda') && page.includes('Luganda') && page.includes('Runyankore') && page.includes('Alur')],
 ['patient 360 medications', api.includes('medication_orders mo JOIN medications m') && api.includes('medications:medications.rows')],
 ['human backend error fallback', api.includes('We could not complete that request. Please try again.')],
 ['responsive intro styles', css.includes('.public-intro-shell') && css.includes('@media(max-width:700px)') && css.includes('@media(min-width:701px) and (max-height:760px)')],
 ['mobile/tablet/desktop intro sizing', css.includes('@media(max-width:1100px)') && css.includes('@media(max-width:700px)') && css.includes('@media(max-width:380px)')],
 ['implementation language removed from key UI', !page.includes('This workspace is connected to its existing clinical data source') && !page.includes('Deterministic signals synthesized across the longitudinal record')],
 ['public path bypass is explicit', api.includes("'/api/public/ai-assist'" ) && api.includes("'/api/public/ai-feedback'") && api.includes('isPublicPath(publicPath)')],
 ['public feedback/run schema', api.includes('public_ai_runs') && api.includes('public_ai_feedback')],
 ['public test patient endpoints', api.includes("'/api/public/test-dashboard'") && api.includes("'/api/public/test-patients'")],
];
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){console.error('Public release audit failed:',failed.map(([n])=>n).join(', '));process.exit(1)}
console.log(`ClinAI public release audit passed: ${checks.length} checks`);
