export type ValidationField = {
  key: string;
  label?: string;
  required?: boolean;
  type?: string;
  options?: string[];
  format?: string;
};

export type ValidationContract = {
  id: string;
  fields: ValidationField[];
  requiredFields: string[];
  relationships?: { field: string; target: string }[];
  permissions?: { write?: string[]; read?: string[] };
  validation?: { rejectBlankStrings?: boolean; rejectInvalidIds?: boolean; organizationScoped?: boolean; backendIndependent?: boolean };
};

export type ValidationIssue = { field: string; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUuid(value: unknown): boolean { return typeof value === 'string' && UUID.test(value.trim()); }
export function isValidDate(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function blank(value: unknown): boolean { return value === undefined || value === null || (typeof value === 'string' && value.trim() === ''); }
function label(field: ValidationField): string { return field.label || field.key; }

export function validateRecord(contract: ValidationContract, body: Record<string, unknown>, options: { partial?: boolean } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fields = contract.fields || [];
  const required = new Set(contract.requiredFields || fields.filter(f => f.required).map(f => f.key));

  for (const field of fields) {
    const value = body[field.key];
    if (!options.partial && required.has(field.key) && blank(value)) {
      issues.push({ field: field.key, message: `${label(field)} is required.` });
      continue;
    }
    if (blank(value)) continue;
    if (typeof value === 'string' && contract.validation?.rejectBlankStrings && value.trim() === '') {
      issues.push({ field: field.key, message: `${label(field)} cannot be blank.` });
      continue;
    }
    if (field.options?.length && !field.options.includes(String(value))) {
      issues.push({ field: field.key, message: `${label(field)} has an invalid value.` });
    }
    const type = field.type || 'text';
    if ((type === 'date' || type === 'datetime-local' || type === 'datetime' || type === 'date-time') && !isValidDate(value)) {
      issues.push({ field: field.key, message: `${label(field)} must be a valid date or date and time.` });
    }
    if ((field.format === 'uuid' || field.key === 'patientId' || field.key.endsWith('Id')) && contract.validation?.rejectInvalidIds && !isUuid(value)) {
      issues.push({ field: field.key, message: `${label(field)} must be a valid identifier.` });
    }
    if (type === 'email' && (typeof value !== 'string' || !EMAIL.test(value.trim()))) {
      issues.push({ field: field.key, message: `${label(field)} must be a valid email address.` });
    }
    if (['number','integer'].includes(type)) {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) issues.push({ field: field.key, message: `${label(field)} must be a valid number.` });
      else if (type === 'integer' && !Number.isInteger(n)) issues.push({ field: field.key, message: `${label(field)} must be a whole number.` });
    }
    if (type === 'boolean' && typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      issues.push({ field: field.key, message: `${label(field)} must be true or false.` });
    }
  }
  return issues;
}

export function firstValidationMessage(issues: ValidationIssue[]): string {
  return issues.length ? issues.map(x => x.message).join(' ') : '';
}

export const WORKFLOW_VALIDATION_CONTRACTS: Record<string, ValidationContract> = {
  checkin: { id:'workflow:checkin', fields:[{key:'appointmentId',required:true,format:'uuid',type:'text'},{key:'patientId',required:true,format:'uuid',type:'text'}], requiredFields:['appointmentId','patientId'], relationships:[{field:'appointmentId',target:'appointments.id'},{field:'patientId',target:'patients.id'}], validation:{rejectBlankStrings:true,rejectInvalidIds:true,organizationScoped:true,backendIndependent:true} },
  triage: { id:'workflow:triage', fields:[{key:'patientId',required:true,format:'uuid',type:'text'},{key:'chiefComplaint',required:true,type:'text'},{key:'acuity',required:true,type:'text',options:['routine','urgent','emergency']}], requiredFields:['patientId','chiefComplaint','acuity'], relationships:[{field:'patientId',target:'patients.id'}], validation:{rejectBlankStrings:true,rejectInvalidIds:true,organizationScoped:true,backendIndependent:true} },
  lab_result: { id:'workflow:lab_result', fields:[{key:'sampleId',required:true,format:'uuid',type:'text'},{key:'testName',required:true,type:'text'}], requiredFields:['sampleId','testName'], relationships:[{field:'sampleId',target:'lab_samples.id'}], validation:{rejectBlankStrings:true,rejectInvalidIds:true,organizationScoped:true,backendIndependent:true} },
  dispense: { id:'workflow:dispense', fields:[{key:'medicationOrderId',required:true,format:'uuid',type:'text'},{key:'quantity',required:true,type:'number'}], requiredFields:['medicationOrderId','quantity'], relationships:[{field:'medicationOrderId',target:'medication_orders.id'}], validation:{rejectBlankStrings:true,rejectInvalidIds:true,organizationScoped:true,backendIndependent:true} },
  discharge: { id:'workflow:discharge', fields:[{key:'encounterId',required:true,format:'uuid',type:'text'}], requiredFields:['encounterId'], relationships:[{field:'encounterId',target:'encounters.id'}], validation:{rejectBlankStrings:true,rejectInvalidIds:true,organizationScoped:true,backendIndependent:true} },
  payment: { id:'workflow:payment', fields:[{key:'invoiceId',required:true,format:'uuid',type:'text'},{key:'amount',required:true,type:'number'},{key:'method',required:true,type:'text'}], requiredFields:['invoiceId','amount','method'], relationships:[{field:'invoiceId',target:'invoices.id'}], validation:{rejectBlankStrings:true,rejectInvalidIds:true,organizationScoped:true,backendIndependent:true} },
  referral: { id:'workflow:referral', fields:[{key:'patientId',required:true,format:'uuid',type:'text'},{key:'destination',required:true,type:'text'},{key:'reason',required:true,type:'text'}], requiredFields:['patientId','destination','reason'], relationships:[{field:'patientId',target:'patients.id'}], validation:{rejectBlankStrings:true,rejectInvalidIds:true,organizationScoped:true,backendIndependent:true} }
};
