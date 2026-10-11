import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = path.resolve(root, 'services/api/build');
const artifact = path.resolve(buildRoot, 'services/api/src/main.js');
const contract = path.resolve(buildRoot, 'packages/module-contracts/contracts.json');
const tenantScope = path.resolve(buildRoot, 'services/api/src/security/tenant-scope.js');

for (const required of [artifact, contract, tenantScope]) {
  if (!fs.existsSync(required)) {
    throw new Error(`Required API runtime artifact missing: ${path.relative(root, required)}`);
  }
  if (fs.statSync(required).isFile() && fs.statSync(required).size === 0) {
    throw new Error(`Required API runtime artifact is empty: ${path.relative(root, required)}`);
  }
}

// Fail during build, not at service startup, if any compiled API module imports a
// relative module that TypeScript did not emit. Walk every emitted JS file in the API
// output, not just main.js, so transitive missing modules are caught before deploy.
function walkJavaScript(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkJavaScript(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

const relativeSpecifier = /(?:from\s*|import\s*)[\'\"](\.{1,2}\/[^\'\"]+)[\'\"]/g;
let checkedImports = 0;
for (const javascriptFile of walkJavaScript(buildRoot)) {
  const source = fs.readFileSync(javascriptFile, 'utf8');
  for (const match of source.matchAll(relativeSpecifier)) {
    const specifier = match[1];
    const resolved = path.resolve(path.dirname(javascriptFile), specifier);
    checkedImports += 1;
    if (!fs.existsSync(resolved)) {
      throw new Error(`API runtime import target missing: ${specifier} from ${path.relative(root, javascriptFile)} (expected ${path.relative(root, resolved)})`);
    }
  }
}

console.log('API_BUILD_ARTIFACT_PASS');
console.log(`Runtime entrypoint: ${path.relative(root, artifact)}`);
console.log(`Compiled module contract catalog: ${path.relative(root, contract)}`);
console.log(`Compiled tenant-scope module: ${path.relative(root, tenantScope)}`);
console.log(`Relative runtime imports checked: ${checkedImports}`);
