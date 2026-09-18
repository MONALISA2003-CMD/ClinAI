import fs from 'node:fs';
const file='apps/web/app/page.tsx';
const s=fs.readFileSync(file,'utf8');
const checks=[
 ['ModuleWorkspace is defined',/function ModuleWorkspace\s*\(/],
 ['Home renders ModuleWorkspace',/<ModuleWorkspace\s+module=\{module\}/],
 ['DomainWorkspace is wired for connected finance/insurance/supply modules',/connectedDomains=\['insurance','claims','inventory','procurement','suppliers','billing','payments','accounting'\]/],
 ['Contract-driven create workflow remains wired',/MODULE_CREATE_ENDPOINTS\[module\]/],
 ['No global MODULE_READ_ONLY gate',!(/MODULE_READ_ONLY/).test(s)],
 ['Patient 360 action is available',/Patient 360/],
 ['Public synthetic patient boundary is retained',/PUBLIC TEST MODULE/]
];
const failed=checks.filter(([,c])=>c instanceof RegExp?!c.test(s):!c);
if(failed.length){console.error(failed.map(([n])=>`FAIL: ${n}`).join('\n'));process.exit(1)}
console.log('Workstream 6 ModuleWorkspace Vercel regression audit passed');
