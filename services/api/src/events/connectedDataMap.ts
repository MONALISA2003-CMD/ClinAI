import { CLINICAL_EVENT_TYPES } from './clinicalEvents.js';

export type ConnectedWorkflowStep = {
  key: string;
  sourceEvents: string[];
  authoritativeTables: string[];
  downstreamTables: string[];
  consequence: string;
  signalTypes?: string[];
  next?: string;
};

export type ConnectedWorkflow = {
  key: string;
  title: string;
  domain: string;
  patientScoped: boolean;
  steps: ConnectedWorkflowStep[];
};

/**
 * Canonical Workstream 3 map. This is an architectural registry, not synthetic
 * data. Domain writes remain authoritative in their existing tables; events
 * describe the transition and downstream consequence.
 */
export const CONNECTED_DATA_MAP: ConnectedWorkflow[] = [
  {
    key: 'patient-lifecycle', title: 'Patient lifecycle', domain: 'care', patientScoped: true,
    steps: [
      { key:'registration', sourceEvents:[CLINICAL_EVENT_TYPES.PATIENT_REGISTERED], authoritativeTables:['patients'], downstreamTables:['appointments','queue_entries'], consequence:'Patient becomes available for scheduling and care intake.', next:'appointment' },
      { key:'appointment', sourceEvents:[CLINICAL_EVENT_TYPES.APPOINTMENT_CREATED], authoritativeTables:['appointments'], downstreamTables:['queue_entries','encounters'], consequence:'Scheduled visit can enter operational flow.', next:'check-in' },
      { key:'check-in', sourceEvents:[CLINICAL_EVENT_TYPES.APPOINTMENT_CHECKED_IN, CLINICAL_EVENT_TYPES.QUEUE_ENTERED, 'queue.transitioned'], authoritativeTables:['queue_entries'], downstreamTables:['encounters','triage records'], consequence:'Patient enters active care workflow.', next:'encounter' },
      { key:'encounter', sourceEvents:[CLINICAL_EVENT_TYPES.ENCOUNTER_STARTED, CLINICAL_EVENT_TYPES.ENCOUNTER_COMPLETED], authoritativeTables:['encounters'], downstreamTables:['clinical_notes','diagnoses','clinical_orders','invoices'], consequence:'Clinical work and downstream charge capture can be recorded.', next:'follow-up' },
      { key:'follow-up', sourceEvents:[CLINICAL_EVENT_TYPES.FOLLOWUP_DUE, CLINICAL_EVENT_TYPES.FOLLOWUP_COMPLETED], authoritativeTables:['care_tasks','appointments'], downstreamTables:['clinical_signals','patient notifications'], consequence:'Ongoing care is monitored for completion.' }
    ]
  },
  {
    key:'clinical-workflow', title:'Core clinical workflow', domain:'clinical', patientScoped:true,
    steps:[
      {key:'assessment',sourceEvents:[CLINICAL_EVENT_TYPES.VITAL_RECORDED,CLINICAL_EVENT_TYPES.TRIAGE_RECORDED,CLINICAL_EVENT_TYPES.ASSESSMENT_RECORDED],authoritativeTables:['observations','triage records'],downstreamTables:['encounters','clinical_notes'],consequence:'Clinical state becomes available for assessment.',next:'diagnosis'},
      {key:'diagnosis',sourceEvents:[CLINICAL_EVENT_TYPES.DIAGNOSIS_RECORDED],authoritativeTables:['diagnoses'],downstreamTables:['clinical_orders','care_plans'],consequence:'Problems can drive orders and care planning.',next:'orders'},
      {key:'orders',sourceEvents:[CLINICAL_EVENT_TYPES.ORDER_CREATED],authoritativeTables:['clinical_orders'],downstreamTables:['laboratory_orders','imaging_orders','medication_orders','invoices'],consequence:'Orders create service, treatment and financial work.',next:'results'},
      {key:'results',sourceEvents:[CLINICAL_EVENT_TYPES.RESULT_VERIFIED,CLINICAL_EVENT_TYPES.RESULT_RELEASED,'lab_result.verify','lab_result.release'],authoritativeTables:['lab_results','imaging_reports','observations'],downstreamTables:['clinical_notes','care_tasks','clinical_signals'],consequence:'Verified results become actionable clinical context.',next:'treatment'},
      {key:'treatment',sourceEvents:[CLINICAL_EVENT_TYPES.MEDICATION_DISPENSED,CLINICAL_EVENT_TYPES.MEDICATION_ADMINISTERED,CLINICAL_EVENT_TYPES.PROCEDURE_COMPLETED],authoritativeTables:['medication_administration','procedures','dispensing records'],downstreamTables:['inventory_batches','stock_movements','clinical_signals'],consequence:'Treatment can consume resources and produce monitoring signals.'}
    ]
  },
  {
    key:'emergency', title:'Emergency', domain:'hospital', patientScoped:true,
    steps:[
      {key:'arrival',sourceEvents:[CLINICAL_EVENT_TYPES.EMERGENCY_ARRIVED],authoritativeTables:['emergency_cases'],downstreamTables:['queue_entries','triage records'],consequence:'Emergency case enters triage.',next:'triage'},
      {key:'triage',sourceEvents:[CLINICAL_EVENT_TYPES.TRIAGE_RECORDED,CLINICAL_EVENT_TYPES.VITAL_RECORDED],authoritativeTables:['triage records','observations'],downstreamTables:['clinical_signals','encounters'],consequence:'Acuity and immediate care priority become available.',next:'assessment'},
      {key:'assessment',sourceEvents:[CLINICAL_EVENT_TYPES.ASSESSMENT_RECORDED],authoritativeTables:['clinical_notes','encounters'],downstreamTables:['clinical_orders','diagnoses'],consequence:'Assessment drives diagnostic and treatment work.',next:'orders'},
      {key:'orders',sourceEvents:[CLINICAL_EVENT_TYPES.ORDER_CREATED],authoritativeTables:['clinical_orders'],downstreamTables:['lab_orders','imaging_orders','medication_orders'],consequence:'Diagnostic and treatment tasks are created.',next:'results'},
      {key:'results',sourceEvents:[CLINICAL_EVENT_TYPES.RESULT_VERIFIED,CLINICAL_EVENT_TYPES.RESULT_RELEASED,'lab_result.verify','lab_result.release'],authoritativeTables:['lab_results','imaging_reports'],downstreamTables:['clinical_notes','care_tasks'],consequence:'Results feed disposition decisions.',next:'treatment'},
      {key:'treatment',sourceEvents:[CLINICAL_EVENT_TYPES.MEDICATION_ADMINISTERED,CLINICAL_EVENT_TYPES.PROCEDURE_COMPLETED],authoritativeTables:['medication_administration','procedures'],downstreamTables:['inventory_batches','stock_movements','invoices'],consequence:'Treatment consumes supplies and may create billable activity.',next:'disposition'},
      {key:'disposition',sourceEvents:[CLINICAL_EVENT_TYPES.DISPOSITION_RECORDED,CLINICAL_EVENT_TYPES.ADMISSION_STARTED,CLINICAL_EVENT_TYPES.DISCHARGE_STARTED],authoritativeTables:['emergency_cases','admissions'],downstreamTables:['beds','nursing tasks','referrals','invoices'],consequence:'Patient moves to discharge, referral or inpatient care.'}
    ]
  },
  {
    key:'inpatient', title:'Inpatient', domain:'hospital', patientScoped:true,
    steps:[
      {key:'admission',sourceEvents:[CLINICAL_EVENT_TYPES.ADMISSION_STARTED],authoritativeTables:['admissions'],downstreamTables:['beds','nursing tasks'],consequence:'Bed and nursing work are activated.',next:'nursing'},
      {key:'nursing',sourceEvents:[CLINICAL_EVENT_TYPES.ASSESSMENT_RECORDED,CLINICAL_EVENT_TYPES.VITAL_RECORDED,CLINICAL_EVENT_TYPES.TASK_CREATED],authoritativeTables:['nursing tasks','observations'],downstreamTables:['medication_administration','clinical_signals'],consequence:'Ongoing inpatient observations and tasks feed treatment.',next:'treatment'},
      {key:'treatment',sourceEvents:[CLINICAL_EVENT_TYPES.MEDICATION_ADMINISTERED,CLINICAL_EVENT_TYPES.PROCEDURE_COMPLETED],authoritativeTables:['medication_administration','procedures'],downstreamTables:['inventory_batches','stock_movements'],consequence:'Treatment consumes medication and supplies.',next:'discharge'},
      {key:'discharge',sourceEvents:[CLINICAL_EVENT_TYPES.DISCHARGE_STARTED,CLINICAL_EVENT_TYPES.ADMISSION_COMPLETED],authoritativeTables:['admissions','clinical_notes'],downstreamTables:['invoices','care_tasks','appointments'],consequence:'Discharge closes the inpatient episode and creates follow-up work.'}
    ]
  },
  {
    key:'surgery', title:'Surgery', domain:'hospital', patientScoped:true,
    steps:[
      {key:'indication',sourceEvents:[CLINICAL_EVENT_TYPES.DIAGNOSIS_RECORDED],authoritativeTables:['diagnoses'],downstreamTables:['surgery records','imaging_orders'],consequence:'A documented problem can establish procedural indication.',next:'imaging'},
      {key:'imaging',sourceEvents:[CLINICAL_EVENT_TYPES.IMAGING_ORDERED,CLINICAL_EVENT_TYPES.IMAGING_REPORTED],authoritativeTables:['imaging_orders','imaging_reports'],downstreamTables:['clinical_notes','surgery records'],consequence:'Imaging contributes to operative planning.',next:'preop'},
      {key:'preop',sourceEvents:[CLINICAL_EVENT_TYPES.ASSESSMENT_RECORDED,CLINICAL_EVENT_TYPES.RESULT_RELEASED],authoritativeTables:['clinical_notes','lab_results'],downstreamTables:['patient_consents','medication_orders','surgery records'],consequence:'Pre-operative readiness is documented.',next:'procedure'},
      {key:'procedure',sourceEvents:[CLINICAL_EVENT_TYPES.PROCEDURE_COMPLETED],authoritativeTables:['procedures','surgery records'],downstreamTables:['medication_administration','inventory_batches','invoices'],consequence:'Procedure creates recovery, resource and financial consequences.',next:'recovery'},
      {key:'recovery',sourceEvents:[CLINICAL_EVENT_TYPES.ASSESSMENT_RECORDED,CLINICAL_EVENT_TYPES.MEDICATION_ADMINISTERED],authoritativeTables:['clinical_notes','observations','medication_administration'],downstreamTables:['admissions','care_tasks'],consequence:'Recovery determines discharge and follow-up work.',next:'follow-up'},
      {key:'follow-up',sourceEvents:[CLINICAL_EVENT_TYPES.FOLLOWUP_DUE,CLINICAL_EVENT_TYPES.FOLLOWUP_COMPLETED],authoritativeTables:['care_tasks','appointments'],downstreamTables:['clinical_signals'],consequence:'Post-operative continuity is tracked.'}
    ]
  },
  {
    key:'maternity', title:'Maternity', domain:'maternity', patientScoped:true,
    steps:[
      {key:'anc',sourceEvents:['maternity.anc.recorded','maternity.risk.assessed'],authoritativeTables:['maternity_anc'],downstreamTables:['clinical_signals','lab_orders'],consequence:'Pregnancy risk and routine care are established.',next:'labs'},
      {key:'labs',sourceEvents:[CLINICAL_EVENT_TYPES.RESULT_VERIFIED,CLINICAL_EVENT_TYPES.RESULT_RELEASED,'lab_result.verify','lab_result.release'],authoritativeTables:['lab_results'],downstreamTables:['maternity_delivery_plans','clinical_notes'],consequence:'Results inform delivery planning.',next:'delivery'},
      {key:'delivery',sourceEvents:['maternity.labour.started','maternity.birth.recorded'],authoritativeTables:['maternity_delivery','birth records'],downstreamTables:['newborn records','postnatal visits'],consequence:'Birth creates maternal and newborn continuity.',next:'newborn'},
      {key:'newborn',sourceEvents:['maternity.newborn.recorded'],authoritativeTables:['newborn records','child_health_visits'],downstreamTables:['immunizations','care_tasks'],consequence:'Newborn care connects to child health.',next:'pnc'},
      {key:'pnc',sourceEvents:['maternity.pnc.recorded'],authoritativeTables:['postnatal visits'],downstreamTables:['appointments','clinical_signals'],consequence:'Postnatal follow-up closes the maternity episode.'}
    ]
  },
  {
    key:'pharmacy', title:'Pharmacy', domain:'pharmacy', patientScoped:true,
    steps:[
      {key:'prescription',sourceEvents:[CLINICAL_EVENT_TYPES.MEDICATION_ORDERED],authoritativeTables:['medication_orders'],downstreamTables:['inventory_items','inventory_batches'],consequence:'Prescription creates an availability check.',next:'availability'},
      {key:'availability',sourceEvents:['inventory.available','pharmacy.availability.checked'],authoritativeTables:['inventory_items','inventory_batches'],downstreamTables:['procurement_requests'],signalTypes:['stockout','workflow-gap'],consequence:'Availability determines dispensing or supply escalation.',next:'dispensing'},
      {key:'dispensing',sourceEvents:[CLINICAL_EVENT_TYPES.MEDICATION_DISPENSED],authoritativeTables:['dispensing records','stock_movements'],downstreamTables:['inventory_batches','medication_administration'],consequence:'Dispensing decrements stock and creates administration work.',next:'administration'},
      {key:'administration',sourceEvents:[CLINICAL_EVENT_TYPES.MEDICATION_ADMINISTERED],authoritativeTables:['medication_administration'],downstreamTables:['clinical_signals','observations'],consequence:'Administration becomes part of the longitudinal clinical record.',next:'monitoring'},
      {key:'monitoring',sourceEvents:[CLINICAL_EVENT_TYPES.MEDICATION_MONITORED,CLINICAL_EVENT_TYPES.MEDICATION_SAFETY_SIGNAL],authoritativeTables:['observations','clinical_signals'],downstreamTables:['care_tasks','clinical_notes'],consequence:'Monitoring can create review tasks and safety signals.'}
    ]
  },
  {
    key:'laboratory', title:'Laboratory', domain:'laboratory', patientScoped:true,
    steps:[
      {key:'order',sourceEvents:[CLINICAL_EVENT_TYPES.ORDER_CREATED],authoritativeTables:['clinical_orders','laboratory_orders'],downstreamTables:['lab_samples'],consequence:'A laboratory order creates accessioning work.',next:'collection'},
      {key:'collection',sourceEvents:[CLINICAL_EVENT_TYPES.SPECIMEN_COLLECTED,CLINICAL_EVENT_TYPES.SPECIMEN_RECEIVED],authoritativeTables:['lab_samples'],downstreamTables:['lab_results'],consequence:'Collected specimens can be processed.',next:'verification'},
      {key:'verification',sourceEvents:[CLINICAL_EVENT_TYPES.LAB_RESULT_CREATED,CLINICAL_EVENT_TYPES.RESULT_VERIFIED],authoritativeTables:['lab_results'],downstreamTables:['clinical_signals','care_tasks','invoices'],consequence:'Verified results become actionable and billable.',next:'release'},
      {key:'release',sourceEvents:[CLINICAL_EVENT_TYPES.RESULT_RELEASED],authoritativeTables:['lab_results'],downstreamTables:['clinical_notes','patient notifications'],consequence:'Results become available to the care team and patient boundary.'}
    ]
  },
  {
    key:'imaging', title:'Imaging', domain:'imaging', patientScoped:true,
    steps:[
      {key:'order',sourceEvents:[CLINICAL_EVENT_TYPES.IMAGING_ORDERED],authoritativeTables:['imaging_orders'],downstreamTables:['imaging_worklist'],consequence:'Imaging request enters worklist.',next:'report'},
      {key:'report',sourceEvents:[CLINICAL_EVENT_TYPES.IMAGING_REPORTED],authoritativeTables:['imaging_reports'],downstreamTables:['clinical_notes','clinical_signals','invoices'],consequence:'Report contributes clinical and financial consequences.'}
    ]
  },
  {
    key:'referrals', title:'Referrals and transfers', domain:'care-coordination', patientScoped:true,
    steps:[
      {key:'created',sourceEvents:[CLINICAL_EVENT_TYPES.REFERRAL_CREATED],authoritativeTables:['referrals'],downstreamTables:['referral_transfers','care_tasks'],consequence:'Referral creates coordination work.',next:'sent'},
      {key:'sent',sourceEvents:[CLINICAL_EVENT_TYPES.REFERRAL_SENT],authoritativeTables:['referrals','referral_transfers'],downstreamTables:['external facility worklist'],consequence:'Receiving facility can act on the referral.',next:'completed'},
      {key:'completed',sourceEvents:[CLINICAL_EVENT_TYPES.REFERRAL_COMPLETED],authoritativeTables:['referrals','referral_transfers'],downstreamTables:['encounters','clinical_notes','care_tasks'],consequence:'Completed referral returns continuity to the patient journey.'}
    ]
  },
  {
    key:'billing', title:'Billing', domain:'finance', patientScoped:true,
    steps:[
      {key:'charge',sourceEvents:[CLINICAL_EVENT_TYPES.CHARGE_CREATED],authoritativeTables:['charges'],downstreamTables:['invoices'],consequence:'Billable activity becomes an invoiceable amount.',next:'invoice'},
      {key:'invoice',sourceEvents:[CLINICAL_EVENT_TYPES.INVOICE_CREATED],authoritativeTables:['invoices','invoice_items'],downstreamTables:['insurance_policies','claims','payments'],consequence:'Invoice establishes payer and patient responsibility.',next:'payment'},
      {key:'payment',sourceEvents:[CLINICAL_EVENT_TYPES.PAYMENT_COMPLETED],authoritativeTables:['payments'],downstreamTables:['finance_reconciliations','accounting_entries'],consequence:'Payment creates reconciliation and accounting work.'}
    ]
  },
  {
    key:'insurance', title:'Insurance', domain:'insurance', patientScoped:true,
    steps:[
      {key:'policy',sourceEvents:[CLINICAL_EVENT_TYPES.INSURANCE_VERIFIED],authoritativeTables:['insurance_policies','insurance_providers'],downstreamTables:['insurance_eligibility_checks'],consequence:'Coverage is verified before claim submission.',next:'authorization'},
      {key:'authorization',sourceEvents:['insurance.authorization.requested','insurance.authorization.approved'],authoritativeTables:['insurance_authorizations'],downstreamTables:['claims'],consequence:'Services requiring preauthorization can proceed with documented coverage.',next:'claim'},
      {key:'claim',sourceEvents:[CLINICAL_EVENT_TYPES.CLAIM_CREATED,CLINICAL_EVENT_TYPES.CLAIM_SUBMITTED],authoritativeTables:['claims','claim_items'],downstreamTables:['claim_responses','payments'],consequence:'Claim moves payer responsibility through adjudication.',next:'response'},
      {key:'response',sourceEvents:['claim.approved','claim.rejected','claim.partially_approved'],authoritativeTables:['claim_responses'],downstreamTables:['claims','payments','invoices'],consequence:'Payer response changes settlement and patient responsibility.'}
    ]
  },
  {
    key:'finance', title:'Finance and reconciliation', domain:'finance', patientScoped:false,
    steps:[
      {key:'invoice',sourceEvents:[CLINICAL_EVENT_TYPES.INVOICE_CREATED],authoritativeTables:['invoices','invoice_items'],downstreamTables:['accounting_entries','claims'],consequence:'Recognized billable activity enters receivables.',next:'payment'},
      {key:'payment',sourceEvents:[CLINICAL_EVENT_TYPES.PAYMENT_COMPLETED],authoritativeTables:['payments'],downstreamTables:['finance_reconciliations','accounting_entries'],consequence:'Collected funds enter reconciliation.',next:'reconciliation'},
      {key:'reconciliation',sourceEvents:[CLINICAL_EVENT_TYPES.PAYMENT_RECONCILED,CLINICAL_EVENT_TYPES.RECONCILIATION_COMPLETED],authoritativeTables:['finance_reconciliations','accounting_entries'],downstreamTables:['invoices','claims'],consequence:'Financial state is synchronized across billing and accounting.'}
    ]
  },
  {
    key:'inventory', title:'Inventory', domain:'supply', patientScoped:false,
    steps:[
      {key:'stock',sourceEvents:[CLINICAL_EVENT_TYPES.INVENTORY_STOCK_RECORDED],authoritativeTables:['inventory_items','inventory_batches','stock_movements'],downstreamTables:['inventory_items'],consequence:'Available quantity becomes traceable by batch and movement.',next:'threshold'},
      {key:'threshold',sourceEvents:[CLINICAL_EVENT_TYPES.INVENTORY_THRESHOLD_REACHED],authoritativeTables:['inventory_items'],downstreamTables:['procurement_requests'],consequence:'Low stock creates replenishment work.',next:'procurement'},
      {key:'procurement',sourceEvents:[CLINICAL_EVENT_TYPES.PROCUREMENT_REQUEST_CREATED],authoritativeTables:['procurement_requests'],downstreamTables:['purchase_orders','suppliers'],consequence:'Approved replenishment creates a purchase order path.',next:'receipt'},
      {key:'receipt',sourceEvents:[CLINICAL_EVENT_TYPES.INVENTORY_RECEIPT_RECORDED],authoritativeTables:['inventory_batches','stock_movements','purchase_orders'],downstreamTables:['inventory_items'],consequence:'Receipt increases traceable stock and closes supply delivery work.',next:'dispensing'},
      {key:'dispensing',sourceEvents:[CLINICAL_EVENT_TYPES.INVENTORY_DISPENSED],authoritativeTables:['stock_movements','inventory_batches'],downstreamTables:['medication_orders','clinical_workflow_events'],consequence:'Consumption feeds clinical availability and reorder monitoring.'}
    ]
  },
  {
    key:'procurement', title:'Procurement', domain:'supply', patientScoped:false,
    steps:[
      {key:'request',sourceEvents:[CLINICAL_EVENT_TYPES.PROCUREMENT_REQUEST_CREATED],authoritativeTables:['procurement_requests'],downstreamTables:['purchase_orders'],consequence:'Supply requirement becomes approval work.',next:'purchase-order'},
      {key:'purchase-order',sourceEvents:[CLINICAL_EVENT_TYPES.PURCHASE_ORDER_CREATED],authoritativeTables:['purchase_orders','purchase_order_items'],downstreamTables:['suppliers','inventory_batches'],consequence:'Issued order creates supplier delivery obligation.',next:'receipt'},
      {key:'receipt',sourceEvents:[CLINICAL_EVENT_TYPES.INVENTORY_RECEIPT_RECORDED],authoritativeTables:['inventory_batches','stock_movements'],downstreamTables:['inventory_items','finance_reconciliations'],consequence:'Received goods become stock and can enter payable/reconciliation processes.'}
    ]
  },
  {
    key:'suppliers', title:'Supplier lifecycle', domain:'supply', patientScoped:false,
    steps:[
      {key:'selection',sourceEvents:[CLINICAL_EVENT_TYPES.SUPPLIER_SELECTED],authoritativeTables:['suppliers'],downstreamTables:['purchase_orders','supplier_performance_snapshots'],consequence:'Selected supplier becomes part of procurement execution.',next:'delivery'},
      {key:'delivery',sourceEvents:[CLINICAL_EVENT_TYPES.INVENTORY_RECEIPT_RECORDED],authoritativeTables:['purchase_orders','inventory_batches'],downstreamTables:['supplier_performance_snapshots','finance_reconciliations'],consequence:'Delivery quality and timeliness can be measured.'},
      {key:'performance',sourceEvents:['supplier.performance.recorded'],authoritativeTables:['supplier_performance_snapshots'],downstreamTables:['procurement_requests'],consequence:'Performance data can inform future sourcing decisions.'}
    ]
  },
  {
    key:'facilities', title:'Facility operations', domain:'operations', patientScoped:false,
    steps:[
      {key:'capacity',sourceEvents:['facility.capacity.recorded','facility.resource.updated'],authoritativeTables:['facility_service_capacity','facility_resource_status'],downstreamTables:['clinical_signals','operations analytics'],consequence:'Capacity and resource state influence operational planning.',next:'incident'},
      {key:'incident',sourceEvents:['facility.incident.created','facility.incident.resolved'],authoritativeTables:['facility_operational_incidents'],downstreamTables:['care_tasks','operations analytics'],consequence:'Operational incidents create response and monitoring work.'}
    ]
  },
  {
    key:'public-health', title:'Public health', domain:'public-health', patientScoped:false,
    steps:[
      {key:'surveillance',sourceEvents:['public_health.surveillance.recorded'],authoritativeTables:['surveillance_events'],downstreamTables:['public_health_investigations'],consequence:'A surveillance event can open investigation work.',next:'investigation'},
      {key:'investigation',sourceEvents:['public_health.investigation.started','public_health.investigation.completed'],authoritativeTables:['public_health_investigations'],downstreamTables:['public_health_response_tasks','clinical_signals'],consequence:'Investigation can create response tasks and patient/community signals.',next:'response'},
      {key:'response',sourceEvents:['public_health.response.task.created','public_health.response.task.completed'],authoritativeTables:['public_health_response_tasks'],downstreamTables:['surveillance_events','operations analytics'],consequence:'Response activity feeds surveillance and operational intelligence.'}
    ]
  },
  {
    key:'intelligence', title:'Intelligence', domain:'intelligence', patientScoped:false,
    steps:[
      {key:'events',sourceEvents:[CLINICAL_EVENT_TYPES.ENCOUNTER_STARTED,CLINICAL_EVENT_TYPES.ORDER_CREATED,CLINICAL_EVENT_TYPES.RESULT_RELEASED,CLINICAL_EVENT_TYPES.PAYMENT_COMPLETED],authoritativeTables:['clinical_workflow_events','outbox_events'],downstreamTables:['clinical_signals','care_graph_edges'],consequence:'Transactional activity is projected into a longitudinal event graph.',next:'signals'},
      {key:'signals',sourceEvents:['clinical.signal.created','workflow-gap.detected'],authoritativeTables:['clinical_signals','care_gap_snapshots'],downstreamTables:['care_tasks','AI context'],consequence:'Deterministic signals identify work requiring human review.',next:'context'},
      {key:'context',sourceEvents:['intelligence.context.built'],authoritativeTables:['clinical_workflow_events','clinical_signals','care_graph_edges'],downstreamTables:['AI audit/evaluation records'],consequence:'Minimum-necessary structured context is supplied to intelligence and AI layers.'}
    ]
  }
];

const workflowByKey = new Map(CONNECTED_DATA_MAP.map(w => [w.key, w]));
export function getConnectedWorkflow(key?: string | null) { return key ? workflowByKey.get(key) || null : null; }
export function listConnectedWorkflows() { return CONNECTED_DATA_MAP; }

export function listEventCatalog() {
  const constants = Object.entries(CLINICAL_EVENT_TYPES).map(([name, eventType]) => ({ name, eventType }));
  const literals = CONNECTED_DATA_MAP.flatMap(workflow => workflow.steps.flatMap(step => step.sourceEvents))
    .filter(eventType => !constants.some(item => item.eventType === eventType));
  const all = [...constants, ...Array.from(new Set(literals)).map(eventType => ({
    name: eventType.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''), eventType
  }))];
  return all.map(({ name, eventType }) => {
    const mappings = CONNECTED_DATA_MAP.flatMap(workflow => workflow.steps
      .filter(step => step.sourceEvents.includes(eventType))
      .map(step => ({ workflow: workflow.key, step: step.key })));
    return { name, eventType, mappings, mapped: mappings.length > 0 };
  });
}

export function validateConnectedDataMap() {
  const errors: string[] = [];
  const keys = new Set(CONNECTED_DATA_MAP.map(w => w.key));
  for (const workflow of CONNECTED_DATA_MAP) {
    if (!workflow.key || !workflow.title || workflow.steps.length === 0) errors.push(`invalid workflow:${workflow.key}`);
    const stepKeys = new Set(workflow.steps.map(s => s.key));
    for (const step of workflow.steps) {
      if (!step.key || !step.sourceEvents.length || !step.authoritativeTables.length) errors.push(`invalid step:${workflow.key}/${step.key}`);
      if (step.next && !stepKeys.has(step.next)) errors.push(`missing next:${workflow.key}/${step.key}->${step.next}`);
    }
  }
  if (keys.size !== CONNECTED_DATA_MAP.length) errors.push('duplicate workflow keys');
  return { ok: errors.length === 0, errors };
}
