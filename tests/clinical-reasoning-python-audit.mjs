import { spawnSync } from 'node:child_process';
const py = String.raw`
from services.intelligence.clinical_reasoning import analyze_clinical_context
ctx={'diagnoses':[{'name':'Hypertension'}],'observations':[{'systolic':190,'diastolic':122,'recordedAt':'2026-09-13T10:00:00Z'}],'labResults':[{'testName':'Potassium','valueNumeric':2.9,'abnormalFlag':'low'}],'medications':[{'name':'penicillin'}],'allergies':[{'name':'penicillin'}],'referrals':[{'status':'open','createdAt':'2026-09-01T00:00:00Z'}],'careTasks':[{'status':'open','priority':'urgent','title':'Review result'}]}
r=analyze_clinical_context(ctx,'Review this patient comprehensively')
assert r['reviewSignals']
assert any(x['type']=='medication-allergy' for x in r['reviewSignals'])
assert any(x['type']=='laboratory' for x in r['reviewSignals'])
assert any(x['type']=='vital' and x['severity']=='urgent' for x in r['reviewSignals'])
assert r['safety'] and 'not diagnoses' in r['safety']
print('PYTHON_CLINICAL_REASONING_PASS')
`;
const r=spawnSync('python',['-c',py],{encoding:'utf8'});
if(r.status!==0){console.error(r.stdout,r.stderr);process.exit(1)}
console.log(r.stdout.trim());
