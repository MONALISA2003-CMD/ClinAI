export type TenantScopedRow = {
  id?: string;
  organizationId?: string | null;
  patientId?: string | null;
  [key: string]: unknown;
};
export declare function rowsForOrganization<T extends TenantScopedRow>(rows: readonly T[] | null | undefined, organizationId: string | null | undefined): T[];
export declare function findForOrganization<T extends TenantScopedRow>(rows: readonly T[] | null | undefined, id: string | null | undefined, organizationId: string | null | undefined): T | undefined;
export declare function rowsForPatientInOrganization<T extends TenantScopedRow>(rows: readonly T[] | null | undefined, patientId: string | null | undefined, organizationId: string | null | undefined, authorizedPatientExists: boolean): T[];
export declare function patientEncounterLinkIsValid(patientId: string | null | undefined, encounterPatientId: string | null | undefined, encounterOrganizationId: string | null | undefined, organizationId: string | null | undefined): boolean;
