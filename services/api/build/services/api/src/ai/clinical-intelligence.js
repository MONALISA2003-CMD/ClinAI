/**
 * Deterministic clinical-intelligence layer.
 *
 * This module does not diagnose or prescribe. It turns already-authorized
 * ClinAI records into traceable attention signals, cross-module consistency
 * checks and compact evidence references for the generative layer.
 */
const text = (v) => String(v ?? '').trim().toLowerCase();
const arr = (v) => Array.isArray(v) ? v : [];
const asDate = (v) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
};
const daysOpen = (v) => {
    const d = asDate(v);
    return d ? Math.max(0, (Date.now() - d.getTime()) / 86400000) : 0;
};
function compact(value, max = 220) {
    const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return s.length > max ? `${s.slice(0, max)}…` : s;
}
function medicationAllergyConflicts(context) {
    const conflicts = [];
    for (const allergy of arr(context.allergies)) {
        const substance = text(allergy.substance);
        if (!substance)
            continue;
        for (const medication of arr(context.medications)) {
            const name = text(medication.name || medication.code);
            if (name && (name.includes(substance) || substance.includes(name))) {
                conflicts.push({
                    type: 'medication-allergy-review',
                    medication: medication.name || medication.code,
                    allergy: allergy.substance,
                    severity: allergy.severity || 'unspecified',
                    source: { medicationId: medication.id, allergySubstance: allergy.substance },
                    message: `A recorded medication name appears to overlap with a recorded allergy substance. Review before acting; ClinAI does not cancel or change the order.`,
                });
            }
        }
    }
    return conflicts.slice(0, 10);
}
function duplicateMedications(context) {
    const groups = new Map();
    for (const m of context) {
        const key = text(m.name || m.code);
        if (!key)
            continue;
        const list = groups.get(key) || [];
        list.push(m);
        groups.set(key, list);
    }
    return [...groups.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([name, list]) => ({ type: 'duplicate-medication-review', medication: name, count: list.length, records: list.map(x => x.id).filter(Boolean) }));
}
function labGaps(context) {
    const results = arr(context.labResults);
    const byOrder = new Map();
    for (const r of results) {
        const key = String(r.orderId || '');
        if (!key)
            continue;
        const list = byOrder.get(key) || [];
        list.push(r);
        byOrder.set(key, list);
    }
    return arr(context.orders)
        .filter(o => text(o.orderType) === 'laboratory')
        .filter(o => !['cancelled', 'completed', 'released'].includes(text(o.status)))
        .filter(o => !byOrder.has(String(o.id)))
        .slice(0, 20)
        .map(o => ({ type: 'order-result-gap', orderId: o.id, orderType: o.orderType, status: o.status, createdAt: o.createdAt, message: 'A laboratory order is recorded without a matching result in the retrieved result set.' }));
}
function imagingGaps(context) {
    const studies = arr(context.imagingStudies);
    const byOrder = new Set(studies.map(x => String(x.orderId || '')).filter(Boolean));
    return arr(context.orders)
        .filter(o => text(o.orderType) === 'imaging')
        .filter(o => !['cancelled', 'completed', 'released'].includes(text(o.status)))
        .filter(o => !byOrder.has(String(o.id)))
        .slice(0, 20)
        .map(o => ({ type: 'imaging-order-gap', orderId: o.id, status: o.status, createdAt: o.createdAt, message: 'An imaging order is recorded without a matching imaging study in the retrieved set.' }));
}
function appointmentEncounterGaps(context) {
    const encounters = arr(context.encounters);
    const appointmentIds = new Set(encounters.map(x => String(x.appointmentId || '')).filter(Boolean));
    return arr(context.appointments)
        .filter(a => ['completed', 'arrived', 'checked-in', 'in-progress'].includes(text(a.status)))
        .filter(a => a.id && !appointmentIds.has(String(a.id)))
        .slice(0, 15)
        .map(a => ({ type: 'appointment-encounter-gap', appointmentId: a.id, status: a.status, startAt: a.startAt, message: 'The appointment status suggests care activity, but no matching encounter was retrieved.' }));
}
function referralGaps(context) {
    return arr(context.referrals)
        .filter(r => !['completed', 'closed', 'cancelled'].includes(text(r.status)) && daysOpen(r.createdAt) >= 7)
        .slice(0, 15)
        .map(r => ({ type: 'referral-closure-gap', referralId: r.id, destination: r.destination, status: r.status, ageDays: Math.round(daysOpen(r.createdAt) * 10) / 10, message: 'An open referral has remained unresolved for at least seven days.' }));
}
function followupGaps(context) {
    return arr(context.followups)
        .filter(f => {
        const due = f.dueAt || f.payload?.dueAt;
        return due && asDate(due) && asDate(due).getTime() < Date.now() && !['completed', 'closed', 'cancelled'].includes(text(f.status));
    })
        .slice(0, 15)
        .map(f => ({ type: 'follow-up-gap', id: f.id, dueAt: f.dueAt || f.payload?.dueAt, status: f.status, message: 'A recorded follow-up is past its due time and remains open.' }));
}
function taskGaps(context) {
    return arr(context.tasks)
        .filter(t => text(t.status) === 'open' && ['critical', 'urgent'].includes(text(t.priority)))
        .slice(0, 15)
        .map(t => ({ type: 'priority-task', taskId: t.id, priority: t.priority, dueAt: t.dueAt, title: t.title, message: 'A high-priority care task remains open.' }));
}
function observationTrends(context) {
    const groups = new Map();
    for (const o of arr(context.observations)) {
        const key = text(o.code || o.display);
        if (!key || o.valueNumeric === null || o.valueNumeric === undefined)
            continue;
        const list = groups.get(key) || [];
        list.push(o);
        groups.set(key, list);
    }
    const trends = [];
    for (const [key, list] of groups) {
        const ordered = [...list].sort((a, b) => (asDate(a.observedAt)?.getTime() || 0) - (asDate(b.observedAt)?.getTime() || 0));
        if (ordered.length < 2)
            continue;
        const latestRow = ordered[ordered.length - 1];
        const first = Number(ordered[0].valueNumeric), latest = Number(latestRow.valueNumeric);
        if (!Number.isFinite(first) || !Number.isFinite(latest) || first === latest)
            continue;
        const delta = latest - first;
        trends.push({ type: 'observation-change', observation: latestRow.display || key, from: first, to: latest, delta: Math.round(delta * 1000) / 1000, unit: latestRow.unit, firstAt: ordered[0].observedAt, latestAt: latestRow.observedAt, message: `The recorded ${latestRow.display || key} value changed from ${first} to ${latest}.` });
    }
    return trends.slice(-20);
}
export function buildPatientIntelligence(context) {
    const consistency = [
        ...labGaps(context),
        ...imagingGaps(context),
        ...appointmentEncounterGaps(context),
        ...referralGaps(context),
        ...followupGaps(context),
        ...taskGaps(context),
        ...medicationAllergyConflicts(context),
        ...duplicateMedications(arr(context.medications)),
    ];
    const attention = consistency.filter(x => ['priority-task', 'follow-up-gap', 'referral-closure-gap', 'medication-allergy-review'].includes(x.type));
    const changes = observationTrends(context);
    const unresolved = consistency.filter(x => !['appointment-encounter-gap'].includes(x.type));
    return {
        generatedAt: new Date().toISOString(),
        summary: {
            consistencySignals: consistency.length,
            attentionSignals: attention.length,
            changes: changes.length,
            unresolved: unresolved.length,
        },
        attention: attention.slice(0, 20),
        changes,
        unresolved: unresolved.slice(0, 30),
        safetyNote: 'These are deterministic review signals, not diagnoses or treatment orders. Confirm against the source record and clinical context.',
    };
}
export function buildEvidenceIndex(context) {
    const evidence = [];
    const add = (module, rows, idKey = 'id', dateKey, label) => {
        for (const row of arr(rows).slice(0, 30)) {
            const id = row[idKey];
            if (!id)
                continue;
            evidence.push({ module, recordId: id, recordedAt: dateKey ? row[dateKey] : undefined, reference: label ? label(row) : module });
        }
    };
    add('encounters', context.encounters, 'id', 'startedAt', x => `${x.type || 'visit'} encounter (${x.status || 'recorded'})`);
    add('observations', context.observations, 'id', 'observedAt', x => `${x.display || x.code || 'observation'}: ${x.valueNumeric ?? x.valueText ?? 'recorded'}`);
    add('diagnoses', context.diagnoses, 'id', undefined, x => `${x.display || x.code || 'diagnosis'} (${x.status || 'recorded'})`);
    add('orders', context.orders, 'id', 'createdAt', x => `${x.orderType || 'order'} order (${x.status || 'recorded'})`);
    add('laboratory', context.labResults, 'id', 'receivedAt', x => `${x.testName || 'laboratory result'} (${x.status || 'recorded'})`);
    add('imaging', context.imagingStudies, 'id', 'createdAt', x => `${x.studyName || 'imaging study'} (${x.status || 'recorded'})`);
    add('pharmacy', context.medications, 'id', 'createdAt', x => `${x.name || x.code || 'medicine'} (${x.status || 'recorded'})`);
    add('referrals', context.referrals, 'id', 'createdAt', x => `${x.destination || 'referral'} (${x.status || 'open'})`);
    add('follow-up', context.followups, 'id', 'createdAt', x => `${x.reason || x.payload?.reason || 'follow-up'} (${x.status || 'recorded'})`);
    add('tasks', context.tasks, 'id', 'createdAt', x => `${x.title || 'care task'} (${x.priority || 'normal'})`);
    add('clinical-alerts', context.clinicalAlerts, 'id', 'createdAt', x => compact(x.payload?.message || x.payload?.reason || 'clinical alert'));
    add('remote-monitoring', context.remoteMonitoring, 'id', 'measuredAt', x => `${x.metric || 'monitoring'}: ${x.valueNumeric ?? 'recorded'}`);
    return evidence.slice(0, 180);
}
export function buildQuestionIntent(question) {
    const q = text(question);
    const intents = [
        ['change', /what changed|changed recently|new|different|trend/],
        ['unresolved', /unresolved|outstanding|pending|still open|what remains/],
        ['safety', /safe|safety|risk|concern|allerg|contra|conflict/],
        ['result', /result|lab|laboratory|imaging|scan|test/],
        ['medication', /medicine|medication|drug|dose|pharmacy/],
        ['followup', /follow.?up|review|appointment|return/],
        ['operations', /queue|waiting|facility|staff|stock|inventory|referral|capacity/],
        ['guidance', /guideline|protocol|who|uganda|ministry|standard|recommendation/],
    ];
    return intents.filter(([, pattern]) => pattern.test(q)).map(([name]) => name);
}
export function compactIntelligenceForPrompt(intelligence) {
    return {
        summary: intelligence.summary,
        attention: arr(intelligence.attention).slice(0, 12),
        changes: arr(intelligence.changes).slice(0, 12),
        unresolved: arr(intelligence.unresolved).slice(0, 15),
        safetyNote: intelligence.safetyNote,
    };
}
