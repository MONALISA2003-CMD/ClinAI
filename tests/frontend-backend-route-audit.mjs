import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const webFile = path.join(root, 'apps/web/app/page.tsx');
const web = fs.readFileSync(webFile, 'utf8');
const apiFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && full.endsWith('.ts')) apiFiles.push(full);
  }
}
walk(path.join(root, 'services/api/src'));
const api = apiFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');

function normalizeRoute(value) {
  let s = value
    .replace(/^\$\{API\}/, '')
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/\?[^`"']*$/, '')
    .replace(/\$\{[^}]*$/, '')
    .replace(/\/$/, '');
  return s || '/';
}

function routePatternMatch(requestPath, routePath) {
  const a = normalizeRoute(requestPath).split('/').filter(Boolean);
  const b = normalizeRoute(routePath).split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((part, i) => part === b[i] || part.startsWith(':') || b[i].startsWith(':'));
}

const frontendPaths = new Set();
for (const match of web.matchAll(/(?:`|['"])\$\{API\}(\/api\/[^`"']+)/g)) {
  frontendPaths.add(normalizeRoute(match[1]));
}

const backendPaths = new Set();
for (const match of api.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*['"](\/api\/[^'"`]+)['"]/g)) {
  backendPaths.add(match[1]);
}

const missing = [];
for (const front of [...frontendPaths].sort()) {
  if (!/\/api\//.test(front)) continue;
  const found = [...backendPaths].some(back => routePatternMatch(front, back));
  if (!found) missing.push(front);
}

const publicPrefixes = ['/api/public/ai-assist', '/api/public/test-dashboard', '/api/public/test-patients', '/api/public/test-intelligence'];
const publicAllow = new Set([...api.matchAll(/PUBLIC_API_PATHS\s*=\s*new Set\(\[([\s\S]*?)\]\)/g)].flatMap(m => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1])));
const publicMissing = publicPrefixes.filter(prefix => {
  const exact = publicAllow.has(prefix);
  const dynamic = prefix.endsWith('/test-patients') || prefix.endsWith('/test-intelligence');
  return !exact && !(dynamic && api.includes(`path.startsWith('${prefix}/')`));
});

const apiBaseDefault = (web.match(/process\.env\.NEXT_PUBLIC_API_URL\|\|'([^']+)'/) || [])[1] || null;

if (missing.length || publicMissing.length) {
  console.error(JSON.stringify({ ok:false, missing, publicMissing, frontendPaths:[...frontendPaths].sort(), backendPaths:[...backendPaths].sort() }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  frontendApiPaths: frontendPaths.size,
  backendRoutes: backendPaths.size,
  missing: [],
  publicBoundary: 'verified',
  defaultApiBase: apiBaseDefault,
}, null, 2));
