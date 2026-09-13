import fs from 'node:fs';
const page=fs.readFileSync('apps/web/app/page.tsx','utf8');
const css=fs.readFileSync('apps/web/app/globals.css','utf8');
const api=fs.readFileSync('services/api/src/main.ts','utf8');
const checks=[
 ['public introduction exists', page.includes('PublicIntroduction')],
 ['30 second automatic entry', page.includes('useState(30)') && page.includes('30-Math.floor')],
 ['development disclaimer', page.includes('NOT YET APPROPRIATE FOR REAL PATIENT USAGE')],
 ['Uganda context', page.includes("Uganda's healthcare realities")],
 ['feedback invitation', page.includes('WE NEED YOUR FEEDBACK')],
 ['Monalisa attribution', page.includes('MONALISA TECH SOLUTIONS')],
 ['WhatsApp contact', page.includes('wa.me/19138992840')],
 ['Gmail contact', page.includes('mail.google.com/mail/?view=cm&fs=1&to=monalisatechsolutions@gmail.com')],
 ['no fake data seeding in web', !/fake|demo patient|sample patient/i.test(page)],
 ['no login page UI', !/<h[12][^>]*>Login<\/h[12]>/i.test(page) && !/>Log in</i.test(page)],
 ['patient 360 medications', api.includes('medication_orders mo JOIN medications m') && api.includes('medications:medications.rows')],
 ['patient timeline medication', api.includes("'medication',m.name")],
 ['human backend error fallback', api.includes("We could not complete that request. Please try again.")],
 ['responsive intro styles', css.includes('.public-intro') && css.includes('@media(max-width:700px)')],
 ['app footer contact', page.includes('app-footer')],
];
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){console.error('Public release audit failed:',failed.map(([n])=>n).join(', '));process.exit(1)}
console.log(`ClinAI public release audit passed: ${checks.length} checks`);
