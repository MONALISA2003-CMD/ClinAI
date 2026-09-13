import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const proc = spawn('python', ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8765'], { cwd: new URL('../services/intelligence/', import.meta.url), stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch('http://127.0.0.1:8765/health'); if (r.ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.equal(ready, true, 'Python intelligence engine did not start');
  const cases = [
    ['English', 'The patient has fever and cough'],
    ['Kiswahili', 'Mgonjwa ana homa na kikohozi'],
    ['Luganda', 'Omulwadde alina omusujja ne kikohola'],
    ['Runyankore', 'Omurwayi aine omushwija n’okukorora'],
  ];
  for (const [expected, text] of cases) {
    const r = await fetch('http://127.0.0.1:8765/v1/language/analyze', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({text})});
    const d = await r.json(); assert.equal(r.ok, true); assert.ok(d.result.supportedLanguages.includes(expected));
    assert.ok(Array.isArray(d.result.clinicalConcepts));
  }
  const ml = await fetch('http://127.0.0.1:8765/v1/ml/logistic', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
    rows:[{x:0,label:0},{x:0.1,label:0},{x:0.2,label:0},{x:1,label:1},{x:1.1,label:1},{x:1.2,label:1}], features:['x'], target:'label', predict:{x:1.05}
  })});
  const md = await ml.json(); assert.equal(ml.ok, true); assert.equal(md.result.operation,'ml_logistic_review_signal'); assert.ok(md.result.prediction);
  console.log('PASS multilingual Python safety audit');
} finally { proc.kill('SIGTERM'); }
