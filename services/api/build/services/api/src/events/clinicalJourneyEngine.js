export const CLINICAL_JOURNEYS = [
    { key: 'emergency', title: 'Emergency', steps: [
            { key: 'arrival', eventTypes: ['emergency.arrived', 'encounter.started'], title: 'Arrival', maxMinutes: 30, next: 'triage' },
            { key: 'triage', eventTypes: ['appointment.checked_in', 'vital.recorded', 'triage.recorded'], title: 'Triage', maxMinutes: 30, next: 'severity' },
            { key: 'severity', eventTypes: ['triage.severity.recorded', 'triage.recorded'], title: 'Severity', maxMinutes: 60, next: 'assessment' },
            { key: 'assessment', eventTypes: ['assessment.recorded', 'nursing.assessment.recorded', 'clinical_note.signed'], title: 'Assessment', maxMinutes: 120, next: 'orders' },
            { key: 'orders', eventTypes: ['order.created'], title: 'Orders', maxMinutes: 180, next: 'results' },
            { key: 'results', eventTypes: ['result.created', 'result.verified', 'result.released'], title: 'Results', maxMinutes: 360, next: 'treatment' },
            { key: 'treatment', eventTypes: ['medication.ordered', 'medication.administered', 'procedure.completed'], title: 'Treatment', maxMinutes: 720, next: 'disposition' },
            { key: 'disposition', eventTypes: ['disposition.recorded', 'admission.started', 'discharge.started', 'referral.sent'], title: 'Disposition', maxMinutes: 1440 }
        ] },
    { key: 'surgery', title: 'Surgery', steps: [
            { key: 'indication', eventTypes: ['diagnosis.recorded', 'surgery.indication.recorded'], title: 'Indication', maxMinutes: 1440, next: 'imaging' },
            { key: 'imaging', eventTypes: ['imaging.ordered', 'imaging.reported', 'result.released'], title: 'Imaging', maxMinutes: 2880, next: 'diagnosis' },
            { key: 'diagnosis', eventTypes: ['diagnosis.recorded'], title: 'Diagnosis', maxMinutes: 2880, next: 'preop' },
            { key: 'preop', eventTypes: ['surgery.preop.recorded', 'nursing.assessment.recorded'], title: 'Pre-op', maxMinutes: 2880, next: 'consent' },
            { key: 'consent', eventTypes: ['surgery.consent.confirmed'], title: 'Consent', maxMinutes: 2880, next: 'labs' },
            { key: 'labs', eventTypes: ['result.released', 'result.verified'], title: 'Labs', maxMinutes: 2880, next: 'medication' },
            { key: 'medication', eventTypes: ['medication.ordered'], title: 'Medication', maxMinutes: 2880, next: 'scheduling' },
            { key: 'scheduling', eventTypes: ['surgery.scheduled'], title: 'Scheduling', maxMinutes: 2880, next: 'procedure' },
            { key: 'procedure', eventTypes: ['surgery.procedure.completed', 'procedure.completed'], title: 'Procedure', maxMinutes: 10080, next: 'recovery' },
            { key: 'recovery', eventTypes: ['surgery.recovery.recorded', 'encounter.started'], title: 'Recovery', maxMinutes: 2880, next: 'discharge' },
            { key: 'discharge', eventTypes: ['discharge.started', 'encounter.completed'], title: 'Discharge', maxMinutes: 10080, next: 'followup' },
            { key: 'followup', eventTypes: ['followup.due', 'followup.completed'], title: 'Follow-up', maxMinutes: 20160 }
        ] },
    { key: 'maternity', title: 'Maternity', steps: [
            { key: 'anc-risk', eventTypes: ['maternity.anc.recorded', 'maternity.risk.assessed'], title: 'ANC risk', maxMinutes: 4320, next: 'danger-signs' },
            { key: 'danger-signs', eventTypes: ['maternity.danger-signs.recorded'], title: 'Danger signs', maxMinutes: 4320, next: 'labs' },
            { key: 'labs', eventTypes: ['result.released', 'result.verified'], title: 'Labs', maxMinutes: 10080, next: 'delivery-planning' },
            { key: 'delivery-planning', eventTypes: ['maternity.delivery-planned'], title: 'Delivery planning', maxMinutes: 10080, next: 'labour' },
            { key: 'labour', eventTypes: ['maternity.labour.started'], title: 'Labour', maxMinutes: 1440, next: 'birth' },
            { key: 'birth', eventTypes: ['maternity.birth.recorded'], title: 'Birth', maxMinutes: 1440, next: 'newborn' },
            { key: 'newborn', eventTypes: ['maternity.newborn.recorded'], title: 'Newborn', maxMinutes: 2880, next: 'pnc' },
            { key: 'pnc', eventTypes: ['maternity.pnc.recorded'], title: 'PNC', maxMinutes: 10080 }
        ] },
    { key: 'pharmacy', title: 'Pharmacy', steps: [
            { key: 'prescription', eventTypes: ['medication.ordered'], title: 'Prescription', maxMinutes: 1440, next: 'availability' },
            { key: 'availability', eventTypes: ['inventory.available', 'pharmacy.availability.checked'], title: 'Availability', maxMinutes: 240, next: 'dispensing' },
            { key: 'dispensing', eventTypes: ['medication.dispensed'], title: 'Dispensing', maxMinutes: 1440, next: 'administration' },
            { key: 'administration', eventTypes: ['medication.administered'], title: 'Administration', maxMinutes: 1440, next: 'monitoring' },
            { key: 'monitoring', eventTypes: ['medication.monitored', 'observation.recorded'], title: 'Monitoring', maxMinutes: 2880, next: 'safety-signal' },
            { key: 'safety-signal', eventTypes: ['medication.safety.signal'], title: 'Safety signal', maxMinutes: 2880 }
        ] },
    { key: 'inventory', title: 'Inventory', steps: [
            { key: 'order', eventTypes: ['inventory.order.created'], title: 'Order', maxMinutes: 1440, next: 'stock' },
            { key: 'stock', eventTypes: ['inventory.stock.recorded', 'inventory.available'], title: 'Stock', maxMinutes: 1440, next: 'threshold' },
            { key: 'threshold', eventTypes: ['inventory.threshold.reached'], title: 'Threshold', maxMinutes: 1440, next: 'procurement' },
            { key: 'procurement', eventTypes: ['procurement.request.created'], title: 'Procurement', maxMinutes: 2880, next: 'supplier' },
            { key: 'supplier', eventTypes: ['supplier.selected'], title: 'Supplier', maxMinutes: 2880, next: 'po' },
            { key: 'po', eventTypes: ['purchase_order.created'], title: 'PO', maxMinutes: 4320, next: 'receipt' },
            { key: 'receipt', eventTypes: ['inventory.receipt.recorded'], title: 'Receipt', maxMinutes: 10080, next: 'dispensing' },
            { key: 'dispensing', eventTypes: ['inventory.dispensed', 'medication.dispensed'], title: 'Dispensing', maxMinutes: 10080 }
        ] },
    { key: 'finance', title: 'Finance', steps: [
            { key: 'encounter', eventTypes: ['encounter.started', 'encounter.completed'], title: 'Encounter', maxMinutes: 1440, next: 'charge' },
            { key: 'charge', eventTypes: ['charge.created'], title: 'Charge', maxMinutes: 1440, next: 'invoice' },
            { key: 'invoice', eventTypes: ['invoice.created'], title: 'Invoice', maxMinutes: 2880, next: 'insurance' },
            { key: 'insurance', eventTypes: ['insurance.verified', 'claim.created'], title: 'Insurance', maxMinutes: 2880, next: 'claim' },
            { key: 'claim', eventTypes: ['claim.created', 'claim.submitted'], title: 'Claim', maxMinutes: 10080, next: 'payment' },
            { key: 'payment', eventTypes: ['payment.completed'], title: 'Payment', maxMinutes: 10080, next: 'reconciliation' },
            { key: 'reconciliation', eventTypes: ['payment.reconciled', 'reconciliation.completed'], title: 'Reconciliation', maxMinutes: 20160 }
        ] }
];
const journeyByEvent = new Map();
for (const journey of CLINICAL_JOURNEYS)
    for (const step of journey.steps)
        for (const event of step.eventTypes)
            journeyByEvent.set(event, { journey, step });
export function journeyForEvent(eventType) { return journeyByEvent.get(eventType) || null; }
async function projectWorkflowEvent(client, event) {
    const inserted = await client.query(`
    INSERT INTO clinical_workflow_events(organization_id,patient_id,encounter_id,event_type,from_state,to_state,payload,actor_id,source_event_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (source_event_id) DO NOTHING
    RETURNING id`, [
        event.organization_id, event.payload?.patientId || null, event.payload?.encounterId || null, event.event_type,
        event.payload?.fromState || null, event.payload?.fromState ? null : null, JSON.stringify(event.payload || {}), null, event.id
    ]);
    return inserted.rows[0]?.id || (await client.query(`SELECT id FROM clinical_workflow_events WHERE source_event_id=$1`, [event.id])).rows[0]?.id || null;
}
async function linkGraph(client, event, workflowId) {
    const patientId = event.payload?.patientId;
    if (!patientId || !workflowId)
        return;
    const prev = await client.query(`SELECT id,source_id,target_id FROM care_graph_edges WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 1`, [event.organization_id, patientId]);
    if (prev.rowCount) {
        await client.query(`INSERT INTO care_graph_edges(organization_id,patient_id,source_type,source_id,target_type,target_id,relationship,metadata) VALUES($1,$2,'workflow_event',$3,'workflow_event',$4,'followed-by',$5) ON CONFLICT DO NOTHING`, [event.organization_id, patientId, prev.rows[0].target_id || prev.rows[0].source_id, workflowId, JSON.stringify({ eventType: event.event_type })]);
    }
    await client.query(`INSERT INTO care_graph_edges(organization_id,patient_id,source_type,source_id,target_type,target_id,relationship,metadata) VALUES($1,$2,'outbox_event',$3,'workflow_event',$4,'materializes',$5) ON CONFLICT DO NOTHING`, [event.organization_id, patientId, event.id, workflowId, JSON.stringify({ eventType: event.event_type })]);
}
async function createGap(client, input) {
    const key = `journey:${input.journey.key}:${input.step.key}:${input.sourceEventId}`;
    const existing = await client.query(`SELECT id FROM clinical_signals WHERE organization_id=$1 AND patient_id=$2 AND signal_type='workflow-gap' AND evidence->>'journeyKey'=$3 AND status IN ('open','acknowledged','snoozed') LIMIT 1`, [input.organizationId, input.patientId, key]);
    if (existing.rowCount)
        return existing.rows[0].id;
    const r = await client.query(`INSERT INTO clinical_signals(organization_id,patient_id,source_event_id,signal_type,severity,status,title,summary,evidence,recommendation,action_url) VALUES($1,$2,$3,'workflow-gap',$4,'open',$5,$6,$7,$8,$9) RETURNING id`, [
        input.organizationId, input.patientId, input.sourceEventId, input.severity || 'moderate', `${input.journey.title}: ${input.step.title} is unfinished`, input.message,
        JSON.stringify({ journeyKey: key, journey: input.journey.key, step: input.step.key, sourceEventId: input.sourceEventId, ...(input.evidence || {}) }),
        'Review the journey state and document the next appropriate step. This signal does not prescribe treatment.', `/patients/${input.patientId}`
    ]);
    return r.rows[0]?.id || null;
}
async function closeGapIfProgressed(client, organizationId, patientId, journey, step) {
    await client.query(`UPDATE clinical_signals SET status='resolved',resolved_at=now(),updated_at=now() WHERE organization_id=$1 AND patient_id=$2 AND signal_type='workflow-gap' AND evidence->>'journey'=$3 AND evidence->>'step'=$4 AND status IN ('open','acknowledged','snoozed')`, [organizationId, patientId, journey.key, step.key]);
}
async function directPharmacyAvailability(client, event) {
    if (event.event_type !== 'medication.ordered')
        return;
    const p = event.payload || {};
    const medicationCode = String(p.medicationCode || '').trim();
    const medicationName = String(p.medicationName || '').trim();
    if (!p.patientId || (!medicationCode && !medicationName))
        return;
    const r = await client.query(`SELECT ii.id,ii.name,ii.sku,COALESCE(sum(ib.quantity),0)::numeric AS quantity,ii.reorder_level AS "reorderLevel" FROM inventory_items ii LEFT JOIN inventory_batches ib ON ib.item_id=ii.id WHERE ii.organization_id=$1 AND ($2='' OR lower(ii.sku)=lower($2) OR lower(ii.name)=lower($3)) GROUP BY ii.id,ii.name,ii.sku,ii.reorder_level ORDER BY quantity DESC LIMIT 1`, [event.organization_id, medicationCode, medicationName]);
    if (!r.rowCount || Number(r.rows[0].quantity) <= 0) {
        await createGap(client, { organizationId: event.organization_id, patientId: String(p.patientId), journey: CLINICAL_JOURNEYS.find(j => j.key === 'pharmacy'), step: CLINICAL_JOURNEYS.find(j => j.key === 'pharmacy').steps.find(s => s.key === 'availability'), sourceEventId: event.id, severity: 'high', message: `A prescription is recorded, but no currently available stock is recorded for the medication in the inventory data.`, evidence: { medicationCode, medicationName, availableQuantity: r.rowCount ? Number(r.rows[0].quantity) : 0 } });
    }
}
export async function processClinicalEvent(pool, event) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const workflowId = await projectWorkflowEvent(client, event);
        await linkGraph(client, event, workflowId);
        await directPharmacyAvailability(client, event);
        const mapped = journeyForEvent(event.event_type);
        if (mapped && event.payload?.patientId) {
            const { journey, step } = mapped;
            await closeGapIfProgressed(client, event.organization_id, String(event.payload.patientId), journey, step);
            if (step.next) {
                const next = journey.steps.find(s => s.key === step.next);
                if (next) {
                    const prior = await client.query(`SELECT created_at,event_type FROM clinical_workflow_events WHERE organization_id=$1 AND patient_id=$2 AND event_type=ANY($3::text[]) ORDER BY created_at DESC LIMIT 1`, [event.organization_id, event.payload.patientId, step.eventTypes]);
                    if (prior.rowCount) {
                        const age = Date.now() - new Date(prior.rows[0].created_at).getTime();
                        if (age > next.maxMinutes * 60000) {
                            const existsNext = await client.query(`SELECT id FROM clinical_workflow_events WHERE organization_id=$1 AND patient_id=$2 AND event_type=ANY($3::text[]) AND created_at>$4 LIMIT 1`, [event.organization_id, event.payload.patientId, next.eventTypes, prior.rows[0].created_at]);
                            if (!existsNext.rowCount)
                                await createGap(client, { organizationId: event.organization_id, patientId: String(event.payload.patientId), journey, step: next, sourceEventId: event.id, severity: next.key === 'safety-signal' ? 'high' : 'moderate', message: `${next.title} has not been recorded after ${step.title} within the configured workflow interval.`, evidence: { previousEvent: step.eventTypes, elapsedMinutes: Math.round(age / 60000) } });
                        }
                    }
                }
            }
        }
        await client.query('COMMIT');
    }
    catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
    finally {
        client.release();
    }
}
export async function scanUnfinishedJourneys(pool, organizationId, patientId) {
    const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
    const patients = patientId ? [{ id: patientId }] : await q(`SELECT id FROM patients WHERE organization_id=$1`, [organizationId]);
    let created = 0;
    for (const p of patients) {
        for (const journey of CLINICAL_JOURNEYS) {
            for (let i = 0; i < journey.steps.length - 1; i++) {
                const step = journey.steps[i], next = journey.steps[i + 1];
                const prev = await q(`SELECT id,created_at FROM clinical_workflow_events WHERE organization_id=$1 AND patient_id=$2 AND event_type=ANY($3::text[]) ORDER BY created_at DESC LIMIT 1`, [organizationId, p.id, step.eventTypes]);
                if (!prev.length)
                    continue;
                const nextRows = await q(`SELECT id FROM clinical_workflow_events WHERE organization_id=$1 AND patient_id=$2 AND event_type=ANY($3::text[]) AND created_at>$4 LIMIT 1`, [organizationId, p.id, next.eventTypes, prev[0].created_at]);
                if (nextRows.length)
                    continue;
                const age = Date.now() - new Date(prev[0].created_at).getTime();
                if (age < next.maxMinutes * 60000)
                    continue;
                const existing = await q(`SELECT id FROM clinical_signals WHERE organization_id=$1 AND patient_id=$2 AND signal_type='workflow-gap' AND evidence->>'journey'=$3 AND evidence->>'step'=$4 AND status IN ('open','acknowledged','snoozed') LIMIT 1`, [organizationId, p.id, journey.key, next.key]);
                if (existing.length)
                    continue;
                await pool.query(`INSERT INTO clinical_signals(organization_id,patient_id,source_event_id,signal_type,severity,status,title,summary,evidence,recommendation,action_url) VALUES($1,$2,$3,'workflow-gap',$4,'open',$5,$6,$7,$8,$9)`, [organizationId, p.id, prev[0].id, 'workflow-gap' === 'workflow-gap' ? 'moderate' : 'moderate', `${journey.title}: ${next.title} is unfinished`, `No ${next.title.toLowerCase()} event is recorded after ${step.title} within the configured workflow interval.`, JSON.stringify({ journey: journey.key, step: next.key, previousStep: step.key, previousEventId: prev[0].id, elapsedMinutes: Math.round(age / 60000) }), 'Review the journey state and document the next appropriate step. This signal does not prescribe treatment.', `/patients/${p.id}`]);
                created++;
            }
        }
    }
    return { patients: patients.length, created };
}
