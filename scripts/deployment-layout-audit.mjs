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
for (const expected of ['rootDir: services/api', 'rootDir: services/intelligence', 'rootDir: services/ai']) {
  if (!render.includes(expected)) throw new Error(`render.yaml missing ${expected}`);
}

console.log('DEPLOYMENT_LAYOUT_PASS');
console.log('Repository root contains package.json and both Vercel/Render deployment definitions.');
console.log('Render service roots: services/api, services/intelligence, services/ai.');
