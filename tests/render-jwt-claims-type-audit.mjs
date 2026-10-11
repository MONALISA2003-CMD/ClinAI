import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../services/api/src/main.ts', import.meta.url), 'utf8');

assert.match(source, /const claims = req\.user;/, 'JWT handler must retain the decoded claims in a local variable');
assert.match(source, /typeof claims === 'object'/, 'JWT handler must narrow claims to an object');
assert.match(source, /claims !== null/, 'JWT handler must reject null before object property checks');
assert.match(source, /!Buffer\.isBuffer\(claims\)/, 'JWT handler must exclude Buffer from decoded claims');
assert.match(source, /'organizationId' in claims/, 'JWT handler must test for the organization claim before reading it');
assert.match(source, /typeof organizationId !== 'string' \|\| organizationId\.trim\(\)\.length === 0/, 'Organization claim must be a non-empty string');
assert.doesNotMatch(source, /if\s*\(\s*!req\.user\?\.organizationId\s*\)/, 'Unsafe direct access to the union-typed JWT user must not return');

console.log('RENDER_JWT_CLAIMS_TYPE_AUDIT_PASS');
