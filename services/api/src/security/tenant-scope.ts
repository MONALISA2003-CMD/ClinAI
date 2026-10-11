/**
 * Fail-closed tenant-scope primitives used by the API and regression tests.
 * Missing organization context never means access to every organization.
 */
export type TenantScopedRow = {
  id?: string;
  organizationId?: string | null;
  patientId?: string | null;
  [key: string]: unknown;
};

export function rowsForOrganization<T extends TenantScopedRow>(
  rows: readonly T[] | null | undefined,
  organizationId: string | null | undefined,
): T[] {
  if (!organizationId || !rows?.length) return [];
  return rows.filter((row) => row?.organizationId === organizationId);
}

export function findForOrganization<T extends TenantScopedRow>(
  rows: readonly T[] | null | undefined,
  id: string | null | undefined,
  organizationId: string | null | undefined,
): T | undefined {
  if (!id || !organizationId) return undefined;
  return rowsForOrganization(rows, organizationId).find((row) => row.id === id);
}

export function rowsForPatientInOrganization<T extends TenantScopedRow>(
  rows: readonly T[] | null | undefined,
  patientId: string | null | undefined,
  organizationId: string | null | undefined,
  authorizedPatientExists: boolean,
): T[] {
  if (!patientId || !organizationId || !authorizedPatientExists) return [];
  return rowsForOrganization(rows, organizationId).filter((row) => row.patientId === patientId);
}

export function patientEncounterLinkIsValid(
  patientId: string | null | undefined,
  encounterPatientId: string | null | undefined,
  encounterOrganizationId: string | null | undefined,
  organizationId: string | null | undefined,
): boolean {
  return Boolean(
    patientId && encounterPatientId && organizationId &&
    encounterOrganizationId === organizationId && encounterPatientId === patientId,
  );
}
