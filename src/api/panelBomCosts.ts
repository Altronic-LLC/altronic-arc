import { USE_MOCK } from "./config";
import { fabricQuery, FabricAuthError, FabricNotConfiguredError, FabricRequestError } from "./fabric";
import { mockDelay } from "./mockLatency";
import { MOCK_PANEL_BOM_COSTS } from "@/data/panelBomMockData";
import { sapMaterialPlants, toSapMaterialCost, type SapMaterialCostRow } from "@/lib/sapMaterialCost";
import { sapKey } from "@/lib/panelBom";

// =============================================================================
// Panel SAP BOM Builder (BusinessIT#59) — SAP unit cost per part, READ-ONLY,
// through Fabric. The same table the Pricing Calculator reads
// (`tbl_cogs_material_api`, GraphQL `tbl_cogs_material_apis`), matched on
// `Material` — the dashed SAP # the parts list already holds.
//
// Cost is NEVER stored on a SharePoint list (Tim, 2026-11-05). Who sees it is
// Fabric's call: somebody without read access on the GraphQL API item is
// refused, and the builder hides every cost column and says why — the
// Supplier performance arrangement.
//
// Measured live 2026-11-05: `Material: { in: [...] }` works and takes at most
// 100 values a query ("IN operator filter object cannot process more than 100
// values at a time"), so ~800 SAP #s are 8 queries, sent together — 1.5 s.
// =============================================================================

/** Fabric refuses an `in` filter longer than this. */
export const FABRIC_IN_FILTER_LIMIT = 100;

const PAGE_SIZE = 1000;
/** A chunk of 100 materials is a few hundred rows at most; past this, a cursor never ended. */
const MAX_PAGES = 10;

/**
 * Whether costs come from SAP. Real mode only — the demo reads invented
 * costs, since its invented SAP numbers aren't in SAP.
 */
export const PANEL_BOM_COSTS_LIVE = !USE_MOCK;

type Page = { items?: SapMaterialCostRow[] | null; endCursor?: string | null; hasNextPage?: boolean } | null;

async function costRows(saps: string[]): Promise<SapMaterialCostRow[]> {
  const query = `query($saps: [String!], $after: String) {
  tbl_cogs_material_apis(first: ${PAGE_SIZE}, after: $after, filter: { Material: { in: $saps } }) {
    items { Plant Material UnitCost }
    endCursor
    hasNextPage
  }
}`;
  const rows: SapMaterialCostRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: { tbl_cogs_material_apis?: Page } = await fabricQuery(query, { saps, after });
    const result = data.tbl_cogs_material_apis;
    rows.push(...(result?.items ?? []));
    if (!result?.hasNextPage || !result.endCursor) return rows;
    after = result.endCursor;
  }
  throw new Error(`SAP returned more than ${MAX_PAGES * PAGE_SIZE} cost rows for ${saps.length} parts — not using a partial answer.`);
}

/**
 * SAP's unit cost for each SAP # asked about, keyed by `sapKey`. Every number
 * asked about is in the map: null means SAP has no cost for it (not found, or
 * 0 — "nobody has costed it", never a $0 part). Where a material has a row
 * per plant, the lowest plant number's cost is used — every panel part read
 * on 2026-11-05 was plant 4222 only.
 */
export async function listPanelBomCosts(sapNumbers: readonly string[]): Promise<Map<string, number | null>> {
  const wanted = [...new Set(sapNumbers.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, number | null>(wanted.map((s) => [sapKey(s), null]));
  if (!PANEL_BOM_COSTS_LIVE) {
    for (const s of wanted) out.set(sapKey(s), MOCK_PANEL_BOM_COSTS[s] ?? null);
    return mockDelay(out);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < wanted.length; i += FABRIC_IN_FILTER_LIMIT) chunks.push(wanted.slice(i, i + FABRIC_IN_FILTER_LIMIT));
  const rows = (await Promise.all(chunks.map(costRows))).flat();
  const byMaterial = new Map<string, ReturnType<typeof toSapMaterialCost>[]>();
  for (const r of rows.map(toSapMaterialCost)) {
    const key = sapKey(r.sapPartNumber);
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), r]);
  }
  for (const [key, list] of byMaterial) {
    if (!out.has(key)) continue;
    out.set(key, sapMaterialPlants(list).find((p) => p.unitCost !== null)?.unitCost ?? null);
  }
  return out;
}

/**
 * Why costs aren't showing, in words. `hidden` is true when the answer is
 * "you don't have access" — the builder then hides cost without offering a
 * retry, since retrying changes nothing.
 */
export function describePanelBomCostFailure(err: unknown): { message: string; hidden: boolean } {
  if (err instanceof FabricNotConfiguredError) {
    return { message: "Costs aren't showing: SAP data isn't connected to ARC.", hidden: true };
  }
  if (err instanceof FabricAuthError) {
    if (err.cause === "account") return { message: `Costs aren't showing: ${err.message}`, hidden: true };
    return {
      message: "Costs are hidden: your sign-in can't read SAP costs. Ask an admin if you need them.",
      hidden: true,
    };
  }
  if (err instanceof FabricRequestError && err.cause === "http" && (err.detail.status === 401 || err.detail.status === 403)) {
    return { message: "Costs are hidden: your account can't read SAP costs. Ask an admin if you need them.", hidden: true };
  }
  return { message: "Couldn't reach SAP for costs just now.", hidden: false };
}
