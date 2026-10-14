import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_NP_SUBASSEMBLIES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { SubAssembly, SubAssemblyLine } from "@/types/pricing";
import { SUB_ASSEMBLY_SELECT, buildSubAssemblyFields, toSubAssembly } from "@/lib/pricingMapper";
import { HistoryUnreadableError } from "@/lib/pricingHistory";
import { nextPricingMockId, pricingMockClone, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// NP Sub-Assemblies — the sub-assemblies of each New Product Pricing
// worksheet, ONE ROW PER SUB-ASSEMBLY PER REVISION (Ray, 2026-10-13: a new
// revision keeps every line of the old one). MANAGERS AND ADMINS ONLY.
//
// The worksheet screen edits a DRAFT in memory and writes it here on save:
//   * Save                 — `saveRevisionRows(ws, rev, drafts)` makes this
//                            revision's rows match the draft (create, update,
//                            remove), and touches no other revision.
//   * Save as new revision — the same call for rev + 1, so every row is new
//                            and the previous revision's rows are untouched.
//
// `WorksheetRef` is a SINGLE lookup — both halves selected, written as a bare
// integer. A row whose Lines JSON couldn't be read is never written over.
// =============================================================================

const ENV = "VITE_SP_NP_SUBASSEMBLIES_LIST_ID";

function listPath(): string {
  if (!SP_NP_SUBASSEMBLIES_LIST_ID) {
    throw new Error(`The NP Sub-Assemblies list isn't set up yet (${ENV} is not set).`);
  }
  return `/sites/${SITES.salesTeam}/lists/${SP_NP_SUBASSEMBLIES_LIST_ID}/items`;
}

function compare(a: SubAssembly, b: SubAssembly): number {
  return a.rev - b.rev || a.sortOrder - b.sortOrder || a.id - b.id;
}

/** Every sub-assembly row of a worksheet, every revision. */
export async function listSubAssemblies(worksheetId: number): Promise<SubAssembly[]> {
  if (USE_MOCK) {
    return mockDelay(pricingMockClone(pricingMockDb.subAssemblies.filter((s) => s.worksheetId === worksheetId)).sort(compare));
  }
  const base = `${listPath()}?$expand=fields($select=${SUB_ASSEMBLY_SELECT})&$top=999`;
  if (!filterRefused) {
    try {
      // WorksheetRef is indexed, so the filter is safe at any list size.
      const items = await graphFetchAll<GraphListItem>(`${base}&$filter=fields/WorksheetRefLookupId eq ${worksheetId}`);
      return items.map(toSubAssembly).sort(compare);
    } catch {
      // Refused (an unindexed column, or a tenant that won't filter on a
      // lookup id): read the list whole and filter here, and remember for the
      // session so the doomed request isn't repeated on every load — the
      // Teradyne Log arrangement. A failure of THAT read propagates.
      filterRefused = true;
    }
  }
  const items = await graphFetchAll<GraphListItem>(base);
  return items.map(toSubAssembly).filter((s) => s.worksheetId === worksheetId).sort(compare);
}

let filterRefused = false;

/** What the screen edits — a row of this revision (`id`), or a new one (`id` null). */
export interface SubAssemblyDraft {
  /** Stable while editing — React keys. */
  key: string;
  /** The row this came from — only reused when it belongs to the revision being saved. */
  id: number | null;
  name: string;
  kind: SubAssembly["kind"];
  altronicPartNumber: string;
  sapPartNumber: string;
  quantityPerProduct: number;
  overheadPct: number | null;
  lines: SubAssemblyLine[];
  fileName: string;
  uploadedAt: string | null;
  uploadedBy: { displayName: string; email: string } | null;
}

export function draftFrom(sub: SubAssembly): SubAssemblyDraft {
  return {
    key: `row-${sub.id}`,
    id: sub.id,
    name: sub.name,
    kind: sub.kind,
    altronicPartNumber: sub.altronicPartNumber,
    sapPartNumber: sub.sapPartNumber,
    quantityPerProduct: sub.quantityPerProduct,
    overheadPct: sub.overheadPct,
    lines: sub.lines.map((l) => ({ ...l })),
    fileName: sub.fileName,
    uploadedAt: sub.uploadedAt,
    uploadedBy: sub.uploadedBy ? { ...sub.uploadedBy } : null,
  };
}

/**
 * Make revision `rev`'s rows match `drafts`. Rows of other revisions are
 * never touched; a draft's `id` is only reused when that row IS this
 * revision's (so saving a new revision always creates fresh rows).
 */
export async function saveRevisionRows(
  worksheetId: number,
  rev: number,
  drafts: SubAssemblyDraft[],
): Promise<SubAssembly[]> {
  const existing = (await listSubAssemblies(worksheetId)).filter((s) => s.rev === rev);
  const mine = new Map(existing.map((s) => [s.id, s]));
  const keep = new Set<number>();

  for (const [i, d] of drafts.entries()) {
    const fields = buildSubAssemblyFields({
      name: d.name,
      kind: d.kind,
      altronicPartNumber: d.altronicPartNumber,
      sapPartNumber: d.sapPartNumber,
      sortOrder: i + 1,
      quantityPerProduct: d.quantityPerProduct,
      overheadPct: d.overheadPct,
      lines: d.lines,
      fileName: d.fileName,
      uploadedAt: d.uploadedAt,
      uploadedBy: d.uploadedBy,
    });
    const row = d.id !== null ? mine.get(d.id) : undefined;
    if (row) {
      if (row.linesCorrupt) throw new HistoryUnreadableError(`"${row.name}" line`);
      keep.add(row.id);
      if (USE_MOCK) {
        const idx = pricingMockDb.subAssemblies.findIndex((s) => s.id === row.id);
        pricingMockDb.subAssemblies[idx] = {
          ...row,
          name: d.name.trim(),
          kind: d.kind,
          altronicPartNumber: d.altronicPartNumber.trim(),
          sapPartNumber: d.sapPartNumber.trim(),
          sortOrder: i + 1,
          quantityPerProduct: d.quantityPerProduct,
      overheadPct: d.overheadPct,
          lines: d.lines.map((l) => ({ ...l })),
          fileName: d.fileName,
          uploadedAt: d.uploadedAt,
          uploadedBy: d.uploadedBy,
        };
      } else {
        await graphFetch(`${listPath()}/${row.id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
      }
    } else if (USE_MOCK) {
      pricingMockDb.subAssemblies.push({
        id: nextPricingMockId(pricingMockDb.subAssemblies),
        worksheetId,
        rev,
        name: d.name.trim(),
        kind: d.kind,
        altronicPartNumber: d.altronicPartNumber.trim(),
        sapPartNumber: d.sapPartNumber.trim(),
        sortOrder: i + 1,
        quantityPerProduct: d.quantityPerProduct,
      overheadPct: d.overheadPct,
        lines: d.lines.map((l) => ({ ...l })),
        linesCorrupt: false,
        fileName: d.fileName,
        uploadedAt: d.uploadedAt,
        uploadedBy: d.uploadedBy,
      });
    } else {
      await graphFetch(listPath(), {
        method: "POST",
        // WorksheetRef is a SINGLE lookup — a bare integer.
        body: JSON.stringify({ fields: { ...fields, WorksheetRefLookupId: worksheetId, Rev: rev } }),
      });
    }
  }

  // A sub-assembly removed from THIS revision's draft. Earlier revisions keep theirs.
  for (const row of existing) {
    if (keep.has(row.id)) continue;
    if (USE_MOCK) pricingMockDb.subAssemblies = pricingMockDb.subAssemblies.filter((s) => s.id !== row.id);
    else await graphFetch(`${listPath()}/${row.id}`, { method: "DELETE" });
  }

  if (USE_MOCK) await mockDelay(null);
  return (await listSubAssemblies(worksheetId)).filter((s) => s.rev === rev);
}
