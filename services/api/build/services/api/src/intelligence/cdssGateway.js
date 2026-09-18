import { randomUUID } from 'node:crypto';
import { evaluateClinicalEvent } from '../events/cdssEvaluator.js';
export const SYNCHRONOUS_CDSS_RULES = Object.freeze(new Set([
    'clinai.critical-lab',
    'clinai.low-spo2',
    'clinai.severe-bp',
    'clinai.medication-allergy-conflict',
]));
function toEvent(input) {
    const payload = {
        ...(input.payload || {}),
        patientId: input.patientId ?? input.payload?.patientId ?? null,
        encounterId: input.encounterId ?? input.payload?.encounterId ?? null,
    };
    return {
        id: input.eventId || randomUUID(),
        organization_id: input.organizationId,
        event_type: input.eventType,
        aggregate_type: input.aggregateType ?? null,
        aggregate_id: input.aggregateId ?? null,
        payload,
    };
}
function decisionFor(result, mode, eventId) {
    const reasons = result.triggeredSignals.map(signal => ({
        ruleKey: signal.ruleKey,
        severity: signal.severity,
        title: signal.title,
        summary: signal.summary,
    }));
    const hasCritical = result.triggeredSignals.some(signal => signal.severity === 'critical');
    const hasTriggered = result.triggeredSignals.length > 0;
    return {
        mode,
        decision: hasCritical ? 'REVIEW' : hasTriggered ? 'WARN' : 'ALLOW',
        evaluated: result.evaluated,
        triggered: result.triggered,
        reasons,
        eventId,
    };
}
/**
 * Single internal CDSS entry point for both background and controlled request-time evaluation.
 * The deterministic evaluator remains the source of clinical rule execution.
 */
export async function evaluateClinicalContext(pool, request) {
    const event = toEvent(request.trigger);
    if (!event.organization_id)
        throw new Error('CDSS organization context is required');
    if (!event.payload.patientId) {
        if (request.mode === 'sync') {
            return { mode: 'sync', decision: 'REVIEW', evaluated: 0, triggered: 0, reasons: [], eventId: event.id };
        }
    }
    const requestedScope = request.ruleScope?.length ? new Set(request.ruleScope) : undefined;
    if (request.mode === 'sync' && requestedScope && [...requestedScope].every(rule => !SYNCHRONOUS_CDSS_RULES.has(rule))) {
        return { mode: 'sync', decision: 'REVIEW', evaluated: 0, triggered: 0, reasons: [], eventId: event.id };
    }
    const ruleScope = request.mode === 'sync'
        ? new Set([...(requestedScope || SYNCHRONOUS_CDSS_RULES)].filter(rule => SYNCHRONOUS_CDSS_RULES.has(rule)))
        : requestedScope;
    const result = await evaluateClinicalEvent(pool, event, { ruleScope });
    return decisionFor(result, request.mode, event.id);
}
