import fs from 'node:fs';
import assert from 'node:assert/strict';

const main=fs.readFileSync('services/api/src/main.ts','utf8');
const ai=fs.readFileSync('services/api/src/ai/ai-orchestrator.ts','utf8');
const web=fs.readFileSync('apps/web/app/page.tsx','utf8');

assert.match(main,/DEMO_AUTH_ENABLED\s*=\s*process\.env\.NODE_ENV\s*!==\s*'production'/,'demo auth must never be enabled in production');
assert.match(main,/role:'viewer'/,'sandbox JWT must be viewer');
assert.doesNotMatch(main,/role:await app\.jwt\.sign\(\{[^}]*role:'admin'/,'admin demo JWT must not exist');
assert.match(main,/const demoTenant=DEMO_AUTH_ENABLED \? await ensureDemoTenant\(\) : null/,'demo tenant creation must be disabled in production');
assert.match(main,/PUBLIC_PREVIEW_READ_ONLY/,'public preview mutation denial missing');
assert.match(main,/if\(isClinicalMutation\(req\)\) requireAuthorizedWrite\(req\)/,'global clinical mutation guard missing');
assert.match(main,/PUBLIC_PREVIEW_READ_ONLY/,'public preview mutation protection missing');
assert.match(main,/app\.get\('\/api\/public\/preview'/,'synthetic public preview endpoint missing');
assert.match(main,/synthetic:true/,'public preview must declare synthetic data');
assert.match(ai,/The public health assistant has been retired/,'public general health assistant must be retired');
assert.match(ai,/const effectiveRole = options\.publicMode \? 'public' : String\(req\.user\?\.role/,'AI role must come from auth context');
assert.match(ai,/if \(!options\.publicMode && !req\.user\?\.sub\)/,'AI clinical assistance must require authentication');
assert.match(ai,/const CLINAI_SCOPE_TERMS/,'strict ClinAI scope allowlist missing');
assert.match(ai,/if \(!isClinAIScope\(text\)\)/,'AI scope must fail closed');
assert.doesNotMatch(web,/role:\s*status\.role/,'frontend must not send a user-selected AI role');
assert.doesNotMatch(web,/\['Leadership','Doctor','Nurse','Pharmacist'\]\.map/,'frontend role selector must be removed');
assert.doesNotMatch(web,/fetch\(`\$\{API\}\/api\/auth\/demo`/,'frontend must not automatically mint demo auth tokens');

console.log('Phase 1 security boundary audit passed.');
