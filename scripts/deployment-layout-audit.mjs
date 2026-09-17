import fs from 'node:fs';
import path from 'node:path';

const required = [
  'package.json',
  'vercel.json',
  'render.yaml',
  'apps/web/package.json',
  'services/api/package.json',
  'services/api/src/main.ts',
  'services/api/Dockerfile',
  'services/api/tsconfig.json',
  'services/intelligence/Dockerfile',
  'services/intelligence/main.py',
  'services/ai/Dockerfile',
  'services/ai/main.py'
];

const missing = required.filter((p) => !fs.existsSync(path.resolve(p)));
if (missing.length) {
  console.error('DEPLOYMENT_LAYOUT_FAIL');
  for (const p of missing) console.error(`Missing: ${p}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!Array.isArray(pkg.workspaces) || !pkg.workspaces.includes('apps/*') || !pkg.workspaces.includes('services/*')) {
  throw new Error('Root workspace manifest is missing expected workspaces.');
}

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
if (vercel.installCommand?.includes('cd ') || vercel.buildCommand?.includes('cd ')) {
  throw new Error('Vercel config should run from repository root, not cd into a nested directory.');
}

const render = fs.readFileSync('render.yaml', 'utf8');
if (!render.includes('rootDir: .')) throw new Error('render.yaml must define the API service from repository root for npm workspaces.');
if (!render.includes('test -f services/api/build/services/api/src/main.js')) throw new Error('Render API build must verify the runtime artifact before deploy.');
if (!render.includes('startCommand: node services/api/build/services/api/src/main.js')) throw new Error('Render API must start the verified runtime artifact directly.');
const apiTs = JSON.parse(fs.readFileSync('services/api/tsconfig.json', 'utf8'));
if (apiTs.compilerOptions?.outDir !== 'build') throw new Error('API TypeScript output must use the non-ignored build directory.');
const apiPkg = JSON.parse(fs.readFileSync('services/api/package.json', 'utf8'));
if (apiPkg.scripts?.start !== 'node build/services/api/src/main.js') throw new Error('API package start script must use the monorepo-safe compiled main entrypoint.');
if (apiTs.compilerOptions?.rootDir !== '../..') throw new Error('API TypeScript rootDir must include imported workspace packages so emitted relative imports remain self-contained.');
const gitignore = fs.readFileSync('.gitignore','utf8').split(/\r?\n/).map(x=>x.trim());
if (gitignore.includes('build') || gitignore.includes('/build') || gitignore.includes('**/build')) throw new Error('The API build directory must not be globally ignored.');
for (const expected of ['rootDir: services/intelligence', 'rootDir: services/ai']) {
  if (!render.includes(expected)) throw new Error(`render.yaml missing ${expected}`);
}

console.log('DEPLOYMENT_LAYOUT_PASS');
console.log('Repository root contains package.json and both Vercel/Render deployment definitions.');
console.log('Render service roots: services/api, services/intelligence, services/ai.');
