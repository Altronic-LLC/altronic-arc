import { USE_MOCK } from "./config";
import { fabricQuery, FabricAuthError, FabricNotConfiguredError, FabricRequestError } from "./fabric";
import { mockDelay } from "./mockLatency";
import { MOCK_SAP_SUPPLIER_PERFORMANCE } from "@/data/srmMockData";
import {
  SAP_SUPPLIER_PERFORMANCE_FIELDS,
  toSapSupplierPerformance,
  type SapSupplierPerformance,
  type SapSupplierPerformanceRow,
} from "@/lib/supplierPerformance";

// =============================================================================
// Supplier performance from SAP — READ-ONLY, through Fabric (Tim, 2026-10-22).
//
// The warehouse table is `tbl_arc_supplier_performance`, exposed on the
// GraphQL API as that name plus an `s`. It was created misspelt
// ("perfomance") and renamed on 2026-10-22; the old name no longer answers.
//
// 321 rows at discovery (one per supplier, all PERIOD_YEAR 2026), so the
// whole table is read in one go and matched to suppliers in the browser —
// one request serves the Suppliers list and every supplier page.
// =============================================================================

/** The GraphQL name of the warehouse table `tbl_arc_supplier_performance`. */
export const SAP_SUPPLIER_PERFORMANCE_TABLE = "tbl_arc_supplier_performances";

const PAGE_SIZE = 1000;

/**
 * Far past the table's size. Reaching it means something has gone wrong
 * (a cursor that never ends), and a partial table would quietly put ARC's
 * figures on suppliers SAP does score — so it throws rather than stopping.
 */
const MAX_PAGES = 20;

/**
 * Whether the figures come from the warehouse. Real mode only — the demo
 * answers from `MOCK_SAP_SUPPLIER_PERFORMANCE`, whatever VITE_FABRIC_IN_DEMO
 * says (that switch is the Pricing Calculator's).
 */
export const SUPPLIER_PERFORMANCE_LIVE = !USE_MOCK;

export async function listSapSupplierPerformance(): Promise<SapSupplierPerformance[]> {
  if (!SUPPLIER_PERFORMANCE_LIVE) {
    return mockDelay(MOCK_SAP_SUPPLIER_PERFORMANCE.map(toSapSupplierPerformance));
  }

  const query = `query($after: String) {
  ${SAP_SUPPLIER_PERFORMANCE_TABLE}(first: ${PAGE_SIZE}, after: $after) {
    items { ${SAP_SUPPLIER_PERFORMANCE_FIELDS.join(" ")} }
    endCursor
    hasNextPage
  }
}`;

  const rows: SapSupplierPerformanceRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: Record<
      string,
      { items?: SapSupplierPerformanceRow[] | null; endCursor?: string | null; hasNextPage?: boolean } | null
    > = await fabricQuery(query, { after });
    const result = data[SAP_SUPPLIER_PERFORMANCE_TABLE];
    rows.push(...(result?.items ?? []));
    if (!result?.hasNextPage || !result.endCursor) return rows.map(toSapSupplierPerformance);
    after = result.endCursor;
  }
  throw new Error(
    `SAP's supplier performance table ran past ${MAX_PAGES * PAGE_SIZE} rows — not reading a partial table.`,
  );
}

/**
 * Why SAP's figures couldn't be read, in words — and that ARC's own are
 * showing instead, since that is what the screen does next. A refused token
 * and a refused query are different fixes, so they're said differently.
 */
export function describeSupplierPerformanceFailure(err: unknown): string {
  const fallback = "Showing the scores entered in ARC.";
  if (err instanceof FabricNotConfiguredError) {
    return `SAP data isn't connected to ARC. ${fallback}`;
  }
  if (err instanceof FabricAuthError) {
    if (err.cause === "account") return `${err.message} ${fallback}`;
    return `Your sign-in can't read SAP yet — ARC hasn't been given Fabric access for your account. ${fallback}`;
  }
  if (err instanceof FabricRequestError && err.cause === "http" && (err.detail.status === 401 || err.detail.status === 403)) {
    return `Your account can't read SAP supplier performance — ask an admin for access. ${fallback}`;
  }
  return `Couldn't reach SAP just now. ${fallback}`;
}
