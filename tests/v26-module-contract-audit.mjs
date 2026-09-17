import { execFileSync } from 'node:child_process';
// V26's original regex expected literal object maps. ClinAI now derives maps from the
// central module contract registry, so this compatibility test delegates to the
// canonical contract audit instead of asserting an obsolete implementation detail.
execFileSync(process.execPath, ['tests/phase2-module-contract-audit.mjs'], { stdio: 'inherit' });
console.log('V26 module contract compatibility audit passed via the canonical contract registry.');
