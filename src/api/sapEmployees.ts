import { FABRIC_IN_DEMO, USE_MOCK } from "./config";
import { fabricQuery, FabricAuthError, FabricNotConfiguredError, FabricRequestError } from "./fabric";
import { mockDelay } from "./mockLatency";
import { MOCK_SAP_EMPLOYEES } from "@/data/hrMockData";
import { SAP_EMPLOYEE_FIELDS, toSapEmployee, type SapEmployee, type SapEmployeeRow } from "@/lib/sapEmployees";

// =============================================================================
// SAP's employee list — READ-ONLY, through Fabric (Tim, 2026-11-20). A New
// Hire page reads it in the background to say whether the hire is in SAP yet.
//
// The warehouse table is `dbo.tbl_arc_employee`, exposed on the GraphQL API as
// that name plus an `s` (the supplier performance arrangement). 211 rows on
// 2026-11-20, so the whole table is read in one request and matched in the
// browser (lib/sapEmployees.ts) — the warehouse matches names case-exactly,
// and people type names however they like.
//
// Who may read it is Fabric's call (Run Queries on the GraphQL API item), not
// ARC's. Somebody without it is told so; nothing else on the page changes.
// =============================================================================

/** The GraphQL name of the warehouse table `dbo.tbl_arc_employee`. */
export const SAP_EMPLOYEE_TABLE = "tbl_arc_employees";

const PAGE_SIZE = 1000;

/** Far past the table's size; reaching it means a cursor that never ends. */
const MAX_PAGES = 20;

/**
 * Whether the list comes from the warehouse. Real mode, or the dev server's
 * demo-with-live-Fabric mode (VITE_FABRIC_IN_DEMO) — so the demo's new hires
 * can be checked against the real list. Plain demo mode reads
 * MOCK_SAP_EMPLOYEES.
 */
export const SAP_EMPLOYEE_LOOKUP_LIVE = !USE_MOCK || FABRIC_IN_DEMO;

export async function listSapEmployees(): Promise<SapEmployee[]> {
  if (!SAP_EMPLOYEE_LOOKUP_LIVE) return mockDelay(MOCK_SAP_EMPLOYEES.map(toSapEmployee));

  const query = `query($after: String) {
  ${SAP_EMPLOYEE_TABLE}(first: ${PAGE_SIZE}, after: $after) {
    items { ${SAP_EMPLOYEE_FIELDS.join(" ")} }
    endCursor
    hasNextPage
  }
}`;

  const rows: SapEmployeeRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: Record<
      string,
      { items?: SapEmployeeRow[] | null; endCursor?: string | null; hasNextPage?: boolean } | null
    > = await fabricQuery(query, { after });
    const result = data[SAP_EMPLOYEE_TABLE];
    rows.push(...(result?.items ?? []));
    if (!result?.hasNextPage || !result.endCursor) return rows.map(toSapEmployee);
    after = result.endCursor;
  }
  throw new Error(`SAP's employee list ran past ${MAX_PAGES * PAGE_SIZE} rows — not reading a partial list.`);
}

/**
 * Only the dev demo-with-live-Fabric mode can offer a sign-in button: the real
 * app signs in to Fabric silently with the ARC session, and never prompts.
 */
export function needsSapEmployeeSignIn(err: unknown): boolean {
  return (
    FABRIC_IN_DEMO && err instanceof FabricAuthError && (err.cause === "not-signed-in" || err.cause === "needs-consent")
  );
}

/** Why the check couldn't run, in words. A refused token and a refused query are different fixes. */
export function describeSapEmployeeFailure(err: unknown): string {
  if (err instanceof FabricNotConfiguredError) return "SAP data isn't connected to ARC, so this can't be checked.";
  if (err instanceof FabricAuthError) {
    if (err.cause === "account") return err.message;
    return "Your sign-in can't read SAP yet — ARC hasn't been given Fabric access for your account.";
  }
  if (err instanceof FabricRequestError && err.cause === "http" && (err.detail.status === 401 || err.detail.status === 403)) {
    return "Your account can't read SAP's employee list — ask an admin for access.";
  }
  return "Couldn't reach SAP just now.";
}
