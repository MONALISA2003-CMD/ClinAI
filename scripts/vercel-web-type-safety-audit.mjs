import fs from 'node:fs';

const page = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const failures = [];
if (/fs\.map\(f=>\{const err=errors\[f\.key\];return/.test(page)) failures.push('Create form fields must establish a safe field label before rendering.');
if (/Select \{f\.label\.toLowerCase\(\)\}/.test(page)) failures.push('Create form must not call toLowerCase on an optional contract label.');
if (/placeholder=\{f\.placeholder\|\|f\.label\}/.test(page)) failures.push('Create form placeholder must use the normalized field label.');
if (!/const fieldLabel=f\.label\|\|pretty\(f\.key\)/.test(page)) failures.push('Create form must normalize optional contract labels.');
if (!/createEndpointContracts=MODULE_CONTRACTS\.filter\(\(c\): c is/.test(page)) failures.push('Create endpoint map must use a type-narrowing predicate.');
if (!/typeof c\.backend\.createEndpoint==='string'/.test(page)) failures.push('Create endpoint narrowing must verify string endpoints.');
if (!/function displayValue\(value:any\):string\{/.test(page)) failures.push('Recursive displayValue formatter must have an explicit string return type.');
if (!/function humanError\(value:any\):string\{/.test(page)) failures.push('Recursive humanError formatter must have an explicit string return type.');
if (failures.length) { console.error('Vercel web type-safety audit failed'); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('Vercel web type-safety audit passed');
