import { randomUUID } from 'crypto';

type EventInput = {
  organizationId: string;
  eventType: string;
  aggregateType?: string | null;
  aggregateId?: string | null;
  patientId?: string | null;
  encounterId?: string | null;
  payload?: Record<string, unknown>;
  eventKey?: string;
};

export const CLINICAL_EVENT_TYPES = Object.freeze({
  PATIENT_REGISTERED: 'patient.registered',
  ENCOUNTER_STARTED: 'encounter.started',
  APPOINTMENT_CHECKED_IN: 'appointment.checked_in',
  VITAL_RECORDED: 'vital.recorded',
  DIAGNOSIS_RECORDED: 'diagnosis.recorded',
  ORDER_CREATED: 'order.created',
  SPECIMEN_COLLECTED: 'specimen.collected',
  RESULT_VERIFIED: 'result.verified',
  MEDICATION_ORDERED: 'medication.ordered',
  MEDICATION_DISPENSED: 'medication.dispensed',
  REFERRAL_CREATED: 'referral.created',
  REFERRAL_COMPLETED: 'referral.completed',
  DISCHARGE_STARTED: 'discharge.started',
  FOLLOWUP_DUE: 'followup.due',
} as const);

/**
 * Transaction-safe outbox writer. Call this with the same pg client as the
 * domain write so a clinical event cannot be published without its record.
 */
export async function enqueueClinicalEvent(client: any, input: EventInput) {
  const eventKey = input.eventKey || randomUUID();
  const payload = {
    ...input.payload,
    patientId: input.patientId ?? input.payload?.patientId ?? null,
    encounterId: input.encounterId ?? input.payload?.encounterId ?? null,
  };
  const result = await client.query(
    `INSERT INTO outbox_events
      (organization_id,event_type,aggregate_type,aggregate_id,payload,event_key)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING id`,
    [input.organizationId, input.eventType, input.aggregateType ?? null,
      input.aggregateId ?? null, JSON.stringify(payload), eventKey]
  );
  return { eventKey, id: result.rows[0]?.id ?? null, inserted: result.rowCount > 0 };
}
