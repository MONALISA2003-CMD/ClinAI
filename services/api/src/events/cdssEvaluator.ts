import type { Pool, PoolClient } from 'pg';

type RuleVersion = {
  id: string;
  ruleKey: string;
  version: string;
  engine: string;
  logic: Record<string, unknown>;
};

type EventRow = {
  id: string;
  organization_id: string;
  event_type: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: Record<string, any>;
};

type Signal = {
  ruleVersionId: string;
  signalType: string;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'informational';
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  recommendation: string;
  actionUrl: string | null;
};

const SUPPORTED_EVENTS = new Set([
  'patient.registered', 'encounter.started', 'appointment.checked_in',
  'vital.recorded', 'diagnosis.recorded', 'order.created', 'specimen.collected',
  'result.verified', 'medication.ordered', 'medication.dispensed',
  'referral.created', 'referral.completed', 'discharge.started', 'followup.due',
  'laboratory.specimen.status',
]);

function text(v: unknown) { return String(v ?? '').trim(); }
function num(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : null; }

async function activeRules(client: PoolClient): Promise<RuleVersion[]> {
  const r = await client.query(`
    SELECT rv.id, gr.rule_key AS "ruleKey", rv.version, rv.engine, rv.logic
    FROM cdss_rule_versions rv
    JOIN clinical_guideline_rules gr ON gr.id=rv.guideline_rule_id
    JOIN clinical_guidelines g ON g.id=gr.guideline_id
    WHERE rv.status='active' AND gr.active=true
      AND (g.status='active' OR g.status IS NULL)
    ORDER BY gr.rule_key, rv.version DESC
  `);
  return r.rows;
}

async function evaluateRule(client: PoolClient, rule: RuleVersion, event: EventRow): Promise<Signal | null> {
  const patientId = text(event.payload?.patientId);
  if (!patientId) return null;
  const orgId = event.organization_id;

  if (rule.ruleKey === 'clinai.critical-lab') {
    const r = await client.query(`
      SELECT lr.id, lt.name AS "testName", lr.value_numeric AS "valueNumeric", lr.value_text AS "valueText",
             lr.unit, lr.abnormal_flag AS "abnormalFlag", lr.critical, lr.status
      FROM lab_results lr
      JOIN lab_samples ls ON ls.id=lr.sample_id
      JOIN clinical_orders co ON co.id=ls.order_id
      JOIN lab_tests lt ON lt.id=lr.test_id
      WHERE co.organization_id=$1 AND co.patient_id=$2
        AND (lr.critical=true OR COALESCE(lower(lr.abnormal_flag),'') NOT IN ('','normal','within-range','within range'))
        AND lr.status IN ('preliminary','verified','released')
      ORDER BY lr.id DESC LIMIT 1
    `, [orgId, patientId]);
    if (!r.rowCount) return null;
    const x = r.rows[0];
    const critical = Boolean(x.critical);
    return {
      ruleVersionId: rule.id, signalType: 'laboratory', severity: critical ? 'critical' : 'high',
      title: critical ? 'Critical laboratory result requires review' : 'Flagged laboratory result requires review',
      summary: `${x.testName || 'Laboratory result'}: ${x.valueNumeric ?? x.valueText ?? 'result'}${x.unit ? ` ${x.unit}` : ''}${x.abnormalFlag ? ` (${x.abnormalFlag})` : ''}`,
      evidence: { resultId: x.id, testName: x.testName, valueNumeric: x.valueNumeric, valueText: x.valueText, unit: x.unit, abnormalFlag: x.abnormalFlag, critical: x.critical },
      recommendation: 'Review the result and patient context promptly; follow the applicable clinical protocol.',
      actionUrl: `/patients/${patientId}`,
    };
  }

  if (rule.ruleKey === 'clinai.low-spo2' || rule.ruleKey === 'clinai.severe-bp') {
    const r = await client.query(`
      SELECT o.id, o.code, o.display, o.value_numeric AS "valueNumeric", o.unit, o.observed_at AS "observedAt"
      FROM observations o JOIN patients p ON p.id=o.patient_id WHERE p.organization_id=$1 AND o.patient_id=$2
      ORDER BY observed_at DESC LIMIT 80
    `, [orgId, patientId]);
    for (const x of r.rows) {
      const code = text(x.code).toLowerCase();
      const value = num(x.valueNumeric);
      if (rule.ruleKey === 'clinai.low-spo2' && value !== null && ['oxygen-saturation','spo2','oxygen_saturation'].includes(code) && value < 90) {
        return { ruleVersionId: rule.id, signalType: 'vital', severity: 'critical', title: 'Very low oxygen saturation needs prompt review', summary: `Recorded oxygen saturation ${value}% is very low.`, evidence: { observationId: x.id, code: x.code, value, unit: x.unit, observedAt: x.observedAt }, recommendation: 'Reassess the patient and follow the applicable local clinical protocol.', actionUrl: `/patients/${patientId}` };
      }
      if (rule.ruleKey === 'clinai.severe-bp' && value !== null && ['systolic-blood-pressure','systolic','blood-pressure','blood_pressure'].includes(code) && value >= 180) {
        return { ruleVersionId: rule.id, signalType: 'vital', severity: 'high', title: 'Markedly elevated systolic blood pressure needs review', summary: `Recorded systolic blood pressure ${value} mmHg is markedly elevated.`, evidence: { observationId: x.id, code: x.code, value, unit: x.unit, observedAt: x.observedAt }, recommendation: 'Repeat or confirm the measurement as appropriate and review the patient in clinical context.', actionUrl: `/patients/${patientId}` };
      }
    }
    return null;
  }

  if (rule.ruleKey === 'clinai.medication-allergy-conflict') {
    const [meds, allergies] = await Promise.all([
      client.query(`SELECT mo.id, m.name AS "medicationName", m.code AS "medicationCode" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id JOIN patients p ON p.id=mo.patient_id WHERE p.organization_id=$1 AND mo.patient_id=$2 AND mo.status NOT IN ('discontinued','completed') ORDER BY mo.id DESC LIMIT 100`, [orgId, patientId]),
      client.query(`SELECT a.id, a.substance AS allergen, a.reaction, a.status FROM allergies a JOIN patients p ON p.id=a.patient_id WHERE p.organization_id=$1 AND a.patient_id=$2 AND COALESCE(a.status,'active')='active' ORDER BY a.id DESC LIMIT 100`, [orgId, patientId]),
    ]);
    for (const m of meds.rows) {
      const name = text(m.medicationName).toLowerCase();
      if (!name) continue;
      const a = allergies.rows.find((x: any) => {
        const allergen = text(x.allergen).toLowerCase();
        return allergen && (name === allergen || name.includes(allergen) || allergen.includes(name));
      });
      if (a) return { ruleVersionId: rule.id, signalType: 'medication-safety', severity: 'critical', title: 'Medication and recorded allergy overlap requires review', summary: `${m.medicationName} appears to overlap with the recorded allergy entry ${a.allergen}.`, evidence: { medicationOrderId: m.id, medicationName: m.medicationName, allergyId: a.id, allergen: a.allergen, reaction: a.reaction }, recommendation: 'Pause and review the medication against the documented allergy before proceeding.', actionUrl: `/patients/${patientId}` };
    }
    return null;
  }

  if (rule.ruleKey === 'clinai.unresolved-order') {
    const r = await client.query(`SELECT co.id, co.order_type AS "orderType", co.status, co.details FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 AND co.patient_id=$2 AND co.status IN ('ordered','pending','in-progress','in_progress') ORDER BY co.created_at DESC LIMIT 1`, [orgId, patientId]);
    if (!r.rowCount) return null;
    const x = r.rows[0];
    return { ruleVersionId: rule.id, signalType: 'workflow', severity: 'moderate', title: 'Clinical order remains unresolved', summary: `${x.orderType || 'Clinical order'} remains ${x.status} in the patient record.`, evidence: { orderId: x.id, orderType: x.orderType, status: x.status, details: x.details || {} }, recommendation: 'Review whether the order needs completion, result follow-up, or documented cancellation.', actionUrl: `/patients/${patientId}` };
  }

  return null;
}

async function persistSignal(client: PoolClient, event: EventRow, signal: Signal) {
  const existing = await client.query(`
    SELECT id FROM clinical_signals
    WHERE organization_id=$1 AND patient_id=$2 AND rule_version_id=$3
      AND status IN ('open','acknowledged','snoozed')
      AND detected_at > now() - interval '24 hours'
      AND evidence->>'eventId' = $4
    LIMIT 1
  `, [event.organization_id, event.payload.patientId, signal.ruleVersionId, event.id]);
  if (existing.rowCount) return existing.rows[0].id;
  const evidence = { ...signal.evidence, eventId: event.id, eventType: event.event_type };
  const r = await client.query(`
    INSERT INTO clinical_signals
      (organization_id,patient_id,encounter_id,rule_version_id,signal_type,severity,status,title,summary,evidence,recommendation,action_url)
    VALUES($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,$11)
    RETURNING id
  `, [event.organization_id, event.payload.patientId, event.payload.encounterId || null, signal.ruleVersionId, signal.signalType, signal.severity, signal.title, signal.summary, JSON.stringify(evidence), signal.recommendation, signal.actionUrl]);
  return r.rows[0].id;
}

export async function evaluateClinicalEvent(pool: Pool, event: EventRow) {
  if (!SUPPORTED_EVENTS.has(event.event_type)) return { evaluated: 0, triggered: 0 };
  const client = await pool.connect();
  const started = Date.now();
  try {
    await client.query('BEGIN');
    const rules = await activeRules(client);
    let triggered = 0;
    for (const rule of rules) {
      const signal = await evaluateRule(client, rule, event);
      await client.query(`
        INSERT INTO cdss_evaluations
          (organization_id,patient_id,encounter_id,rule_version_id,outcome,evaluated_at,duration_ms,evidence,error_code)
        VALUES($1,$2,$3,$4,$5,now(),$6,$7,NULL)
      `, [event.organization_id, event.payload.patientId || null, event.payload.encounterId || null, rule.id, signal ? 'triggered' : 'not_triggered', Date.now() - started, JSON.stringify(signal ? signal.evidence : { eventType: event.event_type })]);
      if (signal) { await persistSignal(client, event, signal); triggered += 1; }
    }
    await client.query('COMMIT');
    return { evaluated: rules.length, triggered };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
