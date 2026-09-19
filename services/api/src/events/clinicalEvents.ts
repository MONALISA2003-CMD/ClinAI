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
  ALLERGY_RECORDED: 'allergy.recorded',
  APPOINTMENT_CREATED: 'appointment.created',
  QUEUE_ENTERED: 'queue.entered',
  ENCOUNTER_STARTED: 'encounter.started',
  ENCOUNTER_COMPLETED: 'encounter.completed',
  CLINICAL_NOTE_SIGNED: 'clinical_note.signed',
  APPOINTMENT_CHECKED_IN: 'appointment.checked_in',
  VITAL_RECORDED: 'vital.recorded',
  TRIAGE_RECORDED: 'triage.recorded',
  EMERGENCY_ARRIVED: 'emergency.arrived',
  ASSESSMENT_RECORDED: 'assessment.recorded',
  DISPOSITION_RECORDED: 'disposition.recorded',
  DIAGNOSIS_RECORDED: 'diagnosis.recorded',
  ORDER_CREATED: 'order.created',
  LAB_RESULT_CREATED: 'result.created',
  SPECIMEN_COLLECTED: 'specimen.collected',
  SPECIMEN_RECEIVED: 'specimen.received',
  RESULT_VERIFIED: 'result.verified',
  RESULT_RELEASED: 'result.released',
  MEDICATION_ORDERED: 'medication.ordered',
  MEDICATION_DISPENSED: 'medication.dispensed',
  MEDICATION_ADMINISTERED: 'medication.administered',
  MEDICATION_MONITORED: 'medication.monitored',
  MEDICATION_SAFETY_SIGNAL: 'medication.safety.signal',
  REFERRAL_CREATED: 'referral.created',
  REFERRAL_SENT: 'referral.sent',
  REFERRAL_COMPLETED: 'referral.completed',
  DISCHARGE_STARTED: 'discharge.started',
  ADMISSION_STARTED: 'admission.started',
  FOLLOWUP_DUE: 'followup.due',
  FOLLOWUP_COMPLETED: 'followup.completed',
  IMAGING_ORDERED: 'imaging.ordered',
  IMAGING_REPORTED: 'imaging.reported',
  IMAGING_STATUS_CHANGED: 'imaging.study.status',
  LABORATORY_PROCESSING: 'laboratory.specimen.processing',
  LABORATORY_REJECTED: 'laboratory.specimen.rejected',
  MEDICATION_DISCONTINUED: 'medication.discontinued',
  MEDICATION_RECONCILIATION_CREATED: 'medication.reconciliation.created',
  MEDICATION_RECONCILIATION_COMPLETED: 'medication.reconciliation.completed',
  PROCEDURE_COMPLETED: 'procedure.completed',
  ADMISSION_COMPLETED: 'admission.completed',
  CHARGE_CREATED: 'charge.created',
  INVOICE_CREATED: 'invoice.created',
  INSURANCE_VERIFIED: 'insurance.verified',
  CLAIM_CREATED: 'claim.created',
  CLAIM_SUBMITTED: 'claim.submitted',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_RECONCILED: 'payment.reconciled',
  RECONCILIATION_COMPLETED: 'reconciliation.completed',
  INVENTORY_ORDER_CREATED: 'inventory.order.created',
  INVENTORY_STOCK_RECORDED: 'inventory.stock.recorded',
  INVENTORY_THRESHOLD_REACHED: 'inventory.threshold.reached',
  PROCUREMENT_REQUEST_CREATED: 'procurement.request.created',
  SUPPLIER_SELECTED: 'supplier.selected',
  PURCHASE_ORDER_CREATED: 'purchase_order.created',
  INVENTORY_RECEIPT_RECORDED: 'inventory.receipt.recorded',
  INVENTORY_DISPENSED: 'inventory.dispensed',
  TASK_CREATED: 'task.created',
  TASK_COMPLETED: 'task.completed',
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
