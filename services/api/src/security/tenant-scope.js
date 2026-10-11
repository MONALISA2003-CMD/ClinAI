/** @typedef {{ id?: string, organizationId?: string | null, patientId?: string | null, [key: string]: any }} TenantScopedRow */

/**
 * Small, dependency-free tenant-scope primitives shared by API code and regression tests.
 * Missing organization context must fail closed: it never means "all organizations".
 * @template {TenantScopedRow} T
 * @param {readonly T[] | null | undefined} rows
 * @param {string | null | undefined} organizationId
 * @returns {T[]}
 */
export function rowsForOrganization(rows, organizationId) {
  if (!organizationId || !rows?.length) return [];
  return rows.filter((row) => row?.organizationId === organizationId);
}

/**
 * @template {TenantScopedRow} T
 * @param {readonly T[] | null | undefined} rows
 * @param {string | null | undefined} id
 * @param {string | null | undefined} organizationId
 * @returns {T | undefined}
 */
export function findForOrganization(rows, id, organizationId) {
  if (!id || !organizationId) return undefined;
  return rowsForOrganization(rows, organizationId).find((row) => row.id === id);
}

/**
 * @template {TenantScopedRow} T
 * @param {readonly T[] | null | undefined} rows
 * @param {string | null | undefined} patientId
 * @param {string | null | undefined} organizationId
 * @param {boolean} authorizedPatientExists
 * @returns {T[]}
 */
export function rowsForPatientInOrganization(rows, patientId, organizationId, authorizedPatientExists) {
  if (!patientId || !organizationId || !authorizedPatientExists) return [];
  return rowsForOrganization(rows, organizationId).filter((row) => row.patientId === patientId);
}

/**
 * @param {string | null | undefined} patientId
 * @param {string | null | undefined} encounterPatientId
 * @param {string | null | undefined} encounterOrganizationId
 * @param {string | null | undefined} organizationId
 * @returns {boolean}
 */
export function patientEncounterLinkIsValid(patientId, encounterPatientId, encounterOrganizationId, organizationId) {
  return Boolean(patientId && encounterPatientId && organizationId && encounterOrganizationId === organizationId && encounterPatientId === patientId);
}
