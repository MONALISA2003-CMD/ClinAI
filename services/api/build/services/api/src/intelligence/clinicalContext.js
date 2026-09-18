/**
 * ClinAI V25 Clinical Context Layer.
 *
 * Integration boundary around the existing Patient 360/AI context builder.
 * It owns no clinical truth and performs no clinical writes. It applies
 * purpose, role and explicit consent-scope policy before context is consumed
 * by CDSS or generative AI.
 */
import { buildPatientIntelligence, buildEvidenceIndex } from '../ai/clinical-intelligence.js';
const TASK_CONTEXTS = {
    medication: ['patient', 'allergies', 'medications', 'reconciliation', 'orders', 'events', 'careGaps', 'riskSignals', 'inventoryAvailability', 'dispensations', 'medicationAdministrations'],
    finance: ['patient', 'encounters', 'appointments', 'invoices', 'claims', 'payments', 'events'],
    billing: ['patient', 'encounters', 'invoices', 'claims', 'payments', 'events'],
    surgical: ['patient', 'encounters', 'diagnoses', 'orders', 'labResults', 'imagingStudies', 'procedures', 'admissions', 'events', 'careGaps', 'riskSignals'],
    surgery: ['patient', 'encounters', 'diagnoses', 'orders', 'labResults', 'imagingStudies', 'procedures', 'admissions', 'events', 'careGaps', 'riskSignals'],
    maternity: ['patient', 'encounters', 'maternal', 'newborn', 'postnatal', 'labResults', 'immunizations', 'events', 'careGaps', 'riskSignals'],
    pharmacy: ['patient', 'allergies', 'medications', 'reconciliation', 'orders', 'dispensations', 'medicationAdministrations', 'inventoryAvailability', 'events', 'careGaps', 'riskSignals'],
    inventory: ['patient', 'medications', 'inventoryAvailability', 'events'],
    publichealth: ['patient', 'surveillance', 'investigations', 'publicHealth', 'events', 'careGaps', 'riskSignals'],
    followup: ['patient', 'encounters', 'diagnoses', 'procedures', 'appointments', 'followups', 'events', 'careGaps', 'riskSignals'],
    clinical: ['patient', 'allergies', 'encounters', 'observations', 'diagnoses', 'orders', 'medications', 'referrals', 'followups', 'immunizations', 'maternal', 'pediatrics', 'growth', 'carePlans', 'tasks', 'notes', 'reconciliation', 'events', 'labResults', 'imagingStudies', 'appointments', 'admissions', 'chronicCare', 'telemedicine', 'remoteMonitoring', 'clinicalAlerts', 'childHealth', 'medicationReconciliation', 'consents', 'portalMessages', 'surveillance', 'investigations', 'responseTasks', 'mortality', 'facilityContext', 'referralNetwork', 'aiEvaluations', 'careGraph', 'careGaps', 'riskSignals', 'patientJourney', 'crossModuleIntelligence'],
};
function taskModules(query, purpose) {
    const q = String(query || '').toLowerCase();
    for (const [key, mods] of Object.entries(TASK_CONTEXTS))
        if (q.includes(key))
            return mods;
    return purpose === 'clinical' ? null : null;
}
const CLINICAL_MODULES = ['patient', 'allergies', 'encounters', 'observations', 'diagnoses', 'orders', 'medications', 'referrals', 'followups', 'immunizations', 'maternal', 'pediatrics', 'growth', 'carePlans', 'tasks', 'notes', 'reconciliation', 'events', 'labResults', 'imagingStudies', 'appointments', 'admissions', 'chronicCare', 'telemedicine', 'remoteMonitoring', 'clinicalAlerts', 'childHealth', 'medicationReconciliation', 'consents', 'portalMessages', 'surveillance', 'investigations', 'responseTasks', 'mortality', 'facilityContext', 'referralNetwork', 'aiEvaluations', 'careGraph', 'careGaps', 'riskSignals', 'patientJourney', 'crossModuleIntelligence', 'finance', 'claims', 'payments', 'supply', 'inventoryAvailability', 'dispensations', 'medicationAdministrations', 'newborn', 'postnatal', 'procedures', 'surveillance', 'investigations', 'publicHealth'];
const COMMUNICATION_MODULES = ['patient', 'appointments', 'telemedicine'];
const OPERATIONS_MODULES = ['patient', 'appointments', 'encounters', 'referrals', 'tasks', 'admissions', 'clinicalAlerts'];
const PORTAL_MODULES = ['patient', 'appointments', 'immunizations', 'carePlans', 'referrals', 'followups', 'telemedicine'];
function purposeFor(value) {
    const p = String(value || 'clinical').toLowerCase();
    if (/portal/.test(p))
        return 'patient-portal';
    if (/communicat|message|translation|patient-message/.test(p))
        return 'communication';
    if (/operation|management|analytics|facility|role-briefing/.test(p))
        return 'operations';
    if (/document|note|referral-draft|discharge-draft|handover/.test(p))
        return 'documentation';
    if (/research/.test(p))
        return 'research';
    if (/cdss|clinical-safety/.test(p))
        return 'cdss';
    return 'clinical';
}
function allowedModules(purpose, role) {
    const clinicalRoles = new Set(['admin', 'doctor', 'nurse', 'lab', 'pharmacist', 'manager']);
    if (purpose === 'patient-portal')
        return PORTAL_MODULES;
    if (purpose === 'communication')
        return COMMUNICATION_MODULES;
    if (purpose === 'operations')
        return clinicalRoles.has(role) ? OPERATIONS_MODULES : ['patient', 'appointments'];
    if (purpose === 'documentation' || purpose === 'cdss' || purpose === 'clinical' || purpose === 'research') {
        return clinicalRoles.has(role) ? CLINICAL_MODULES : ['patient', 'appointments', 'encounters', 'tasks'];
    }
    return ['patient'];
}
function scopeModules(scope) {
    if (!scope || typeof scope !== 'object')
        return null;
    const raw = scope.allowedModules ?? scope.modules ?? scope.contextModules;
    return Array.isArray(raw) ? raw.map(String).filter(Boolean) : null;
}
function redactPatientForContext(patient, purpose) {
    if (!patient)
        return patient;
    if (purpose === 'communication' || purpose === 'operations' || purpose === 'patient-portal') {
        const { firstName, middleName, lastName, patientNumber, dateOfBirth, sex, preferredLanguage, status } = patient;
        return { firstName, middleName, lastName, patientNumber, dateOfBirth, sex, preferredLanguage, status };
    }
    return patient;
}
function prune(raw, modules, purpose) {
    const out = {};
    for (const key of modules)
        if (Object.prototype.hasOwnProperty.call(raw, key))
            out[key] = raw[key];
    out.patient = redactPatientForContext(out.patient || null, purpose);
    out.intelligence = buildPatientIntelligence(out);
    out.evidenceIndex = buildEvidenceIndex(out);
    return out;
}
export async function buildClinicalContext(input) {
    const purpose = purposeFor(input.purpose);
    const role = String(input.role || '').toLowerCase();
    if (!input.organizationId)
        return { patient: null, contextPolicy: { allowed: false, reason: 'missing-organization' } };
    const patientCheck = await input.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2 LIMIT 1', [input.patientId, input.organizationId]);
    if (!patientCheck.length)
        return { patient: null, contextPolicy: { allowed: false, reason: 'patient-not-found', purpose } };
    const consentRows = await input.query(`SELECT id,consent_type AS "consentType",status,scope,granted_at AS "grantedAt",expires_at AS "expiresAt"
    FROM patient_consents WHERE organization_id=$1 AND patient_id=$2
      AND consent_type IN ('ai','clinical-intelligence','clinical_ai','patient-portal','research')
    ORDER BY granted_at DESC`, [input.organizationId, input.patientId]).catch(() => []);
    const now = Date.now();
    const activeConsents = consentRows.filter(c => c.status === 'active' && (!c.expiresAt || new Date(c.expiresAt).getTime() > now));
    const relevant = activeConsents.find(c => ['ai', 'clinical-intelligence', 'clinical_ai'].includes(String(c.consentType).toLowerCase()));
    const explicitWithdrawn = consentRows.some(c => ['ai', 'clinical-intelligence', 'clinical_ai'].includes(String(c.consentType).toLowerCase()) && c.status === 'withdrawn');
    if (explicitWithdrawn && !relevant)
        return { patient: null, contextPolicy: { allowed: false, reason: 'ai-consent-withdrawn', purpose, consentStatus: 'withdrawn' } };
    const policyModules = allowedModules(purpose, role);
    const taskSpecific = taskModules(input.queryText || input.purpose || '', purpose);
    const taskFiltered = taskSpecific ? policyModules.filter(m => taskSpecific.includes(m)) : policyModules;
    const consentScope = scopeModules(relevant?.scope);
    const modules = consentScope ? taskFiltered.filter(m => consentScope.includes(m)) : taskFiltered;
    const raw = await input.rawBuilder(input.pool, input.organizationId, input.patientId);
    const context = prune(raw, modules, purpose);
    context.contextPolicy = {
        allowed: true,
        purpose,
        role,
        consentStatus: relevant ? 'active' : (consentRows.length ? 'not-active' : 'not-recorded'),
        consentType: relevant?.consentType || null,
        consentScopeApplied: Boolean(consentScope),
        taskContextApplied: Boolean(taskSpecific),
        moduleCount: modules.length,
        generatedAt: new Date().toISOString(),
    };
    return context;
}
export { purposeFor, allowedModules };
