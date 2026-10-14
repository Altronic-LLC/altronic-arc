import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_NEW_PRODUCT_PRICING_LIST_ID, SP_SALESTEAM_SITE_URL, USE_MOCK } from "./config";
import { resolvePeopleLookupIds } from "./siteUsers";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, Person } from "@/types/task";
import type { NewProductRevision, NewProductWorksheet } from "@/types/pricing";
import {
  NEW_PRODUCT_SELECT,
  PRICING_ITEM_LEVEL_SELECT,
  applyNewProductPatch,
  buildNewProductFields,
  compareWorksheets,
  toNewProductWorksheet,
  type NewProductPatch,
} from "@/lib/pricingMapper";
import { nextPricingNumber } from "@/lib/pricingNumber";
import { parseRevisionHistory, saveRevisionHistory, HistoryUnreadableError } from "@/lib/pricingHistory";
import { STANDARD_DISTRIBUTOR_DISCOUNT_PCT } from "@/lib/pricingMath";
import { isUniqueValueRejection, mockUniqueRejection } from "@/lib/quoteMapper";
import { nextPricingMockId, pricingMockClone, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// New Product Pricing — worksheets for products not yet in SAP. MANAGERS AND
// ADMINS ONLY (the list's own permissions). **No delete**: a worksheet that
// no longer applies is Cancelled.
//
// ONE row per worksheet, carrying its CURRENT revision as columns, and every
// revision's totals in `History` (JSON, lib/pricingHistory.ts). The lines are
// on NP Sub-Assemblies, one row per sub-assembly per revision. Each
// save is the manager's choice (Ray, 2026-10-13):
//   * Save            — rewrites the current revision's snapshot.
//   * Save as new rev — Rev + 1, a new snapshot appended; earlier ones are
//                       never rewritten.
// History is re-read FRESH before every save and never written over when it
// can't be parsed.
// =============================================================================

function listPath(): string {
  return `/sites/${SITES.salesTeam}/lists/${SP_NEW_PRODUCT_PRICING_LIST_ID}/items`;
}

const READ = `?$select=${PRICING_ITEM_LEVEL_SELECT}&$expand=fields($select=${NEW_PRODUCT_SELECT})`;

function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 404 || /\b404\b|itemNotFound/i.test(err instanceof Error ? err.message : String(err));
}

export async function listNewProductWorksheets(): Promise<NewProductWorksheet[]> {
  if (USE_MOCK) return mockDelay(pricingMockClone(pricingMockDb.worksheets).sort(compareWorksheets));
  const items = await graphFetchAll<GraphListItem>(`${listPath()}${READ}&$top=999`);
  return items.map(toNewProductWorksheet).sort(compareWorksheets);
}

export async function getNewProductWorksheet(id: number): Promise<NewProductWorksheet | null> {
  if (USE_MOCK) {
    const found = pricingMockDb.worksheets.find((w) => w.id === id);
    return mockDelay(found ? pricingMockClone(found) : null);
  }
  const item = await graphFetch<GraphListItem>(`${listPath()}/${id}${READ}`).catch((err: unknown) => {
    if (isNotFound(err)) return null;
    throw err;
  });
  return item ? toNewProductWorksheet(item) : null;
}

async function listTitles(): Promise<string[]> {
  if (USE_MOCK) return pricingMockDb.worksheets.map((w) => w.worksheetNumber);
  const items = await graphFetchAll<GraphListItem>(`${listPath()}?$expand=fields($select=Title)&$top=999`);
  return items.map((i) => String(i.fields?.Title ?? ""));
}

export interface NewProductCreateInput {
  productName: string;
  description: string;
  customerSoldTo: string;
  customerName: string;
  expectedAnnualVolume: number | null;
  requestId: number | null;
  createdBy: Person;
}

async function postWorksheet(worksheetNumber: string, input: NewProductCreateInput): Promise<NewProductWorksheet> {
  if (USE_MOCK) {
    if (pricingMockDb.worksheets.some((w) => w.worksheetNumber === worksheetNumber)) {
      await mockDelay();
      throw mockUniqueRejection("Title", worksheetNumber);
    }
    const now = new Date().toISOString();
    const row: NewProductWorksheet = {
      id: nextPricingMockId(pricingMockDb.worksheets),
      worksheetNumber,
      status: "Active",
      rev: 1,
      productName: input.productName.trim(),
      description: input.description,
      customerSoldTo: input.customerSoldTo.trim(),
      customerName: input.customerName.trim(),
      expectedAnnualVolume: input.expectedAnnualVolume,
      requestId: input.requestId,
      overheadPct: 0,
      mpg: "",
      distributorDiscountPct: STANDARD_DISTRIBUTOR_DISCOUNT_PCT,
      discountSource: "Default",
      targetGM: null,
      unitCost: null,
      listPrice: null,
      baseGM: null,
      priceBreaks: [],
      altronicPartNumber: "",
      sapPartNumber: "",
      comparisonParts: [],
      history: [],
      historyCorrupt: false,
      comments: [],
      watchers: [{ ...input.createdBy }],
      hasAttachments: false,
      createdBy: { ...input.createdBy },
      createdAt: now,
      modifiedAt: now,
    };
    pricingMockDb.worksheets.push(row);
    return mockDelay(pricingMockClone(row));
  }
  const fields: Record<string, unknown> = {
    Title: worksheetNumber,
    Status: "Active",
    Rev: 1,
    DistributorDiscountPct: STANDARD_DISTRIBUTOR_DISCOUNT_PCT,
    DiscountSource: "Default",
    ...buildNewProductFields({
      productName: input.productName,
      description: input.description,
      customerSoldTo: input.customerSoldTo,
      customerName: input.customerName,
      expectedAnnualVolume: input.expectedAnnualVolume,
    }),
  };
  // A SINGLE lookup — a bare integer, and only when there is one.
  if (input.requestId) fields.RequestRefLookupId = input.requestId;
  // Whoever starts a worksheet watches it — resolved on the Sales site.
  const watchers = await resolvePeopleLookupIds(SITES.salesTeam, SP_SALESTEAM_SITE_URL, [input.createdBy]);
  if (watchers.some((p) => p.lookupId)) Object.assign(fields, multiPersonField("Watchers", watchers));
  const created = await graphFetch<GraphListItem>(listPath(), { method: "POST", body: JSON.stringify({ fields }) });
  return (await getNewProductWorksheet(parseInt(created.id, 10))) ?? toNewProductWorksheet(created);
}

/** Start a worksheet at R1, numbered NP-<this year>-####. One retry on a unique refusal. */
export async function createNewProductWorksheet(
  input: NewProductCreateInput,
  now: Date = new Date(),
): Promise<NewProductWorksheet> {
  const year = now.getFullYear();
  const first = nextPricingNumber("NP", year, await listTitles());
  try {
    return await postWorksheet(first, input);
  } catch (err) {
    if (!isUniqueValueRejection(err)) throw err;
    const second = nextPricingNumber("NP", year, await listTitles());
    if (second === first) throw err;
    return postWorksheet(second, input);
  }
}

/**
 * Save the working figures, with `snapshot` recorded as revision
 * `snapshot.rev` — the current rev for a plain Save, current + 1 for a new
 * revision. The Rev column moves with it in the SAME PATCH.
 */
export async function saveNewProductWorksheet(
  id: number,
  patch: NewProductPatch,
  snapshot: NewProductRevision,
): Promise<NewProductWorksheet> {
  if (USE_MOCK) {
    const idx = pricingMockDb.worksheets.findIndex((w) => w.id === id);
    if (idx < 0) throw new Error(`Worksheet ${id} not found`);
    const current = pricingMockDb.worksheets[idx];
    if (current.historyCorrupt) throw new HistoryUnreadableError("revision");
    const history = parseRevisionHistory(saveRevisionHistory(JSON.stringify(current.history), snapshot)).entries;
    const next: NewProductWorksheet = {
      ...applyNewProductPatch(current, patch),
      rev: snapshot.rev,
      history,
      modifiedAt: new Date().toISOString(),
    };
    pricingMockDb.worksheets[idx] = next;
    return mockDelay(pricingMockClone(next));
  }
  const fresh = await graphFetch<GraphListItem>(`${listPath()}/${id}?$expand=fields($select=History)`);
  const history = saveRevisionHistory(fresh.fields?.History, snapshot);
  await graphFetch(`${listPath()}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ ...buildNewProductFields(patch), Rev: snapshot.rev, History: history }),
  });
  const updated = await getNewProductWorksheet(id);
  if (!updated) throw new Error(`Worksheet ${id} disappeared after saving`);
  return updated;
}

/** A write that records no revision — Cancel, or the remembered Compare to SAP part numbers. */
export async function updateNewProductWorksheet(id: number, patch: NewProductPatch): Promise<NewProductWorksheet> {
  if (USE_MOCK) {
    const idx = pricingMockDb.worksheets.findIndex((w) => w.id === id);
    if (idx < 0) throw new Error(`Worksheet ${id} not found`);
    const next = { ...applyNewProductPatch(pricingMockDb.worksheets[idx], patch), modifiedAt: new Date().toISOString() };
    pricingMockDb.worksheets[idx] = next;
    return mockDelay(pricingMockClone(next));
  }
  const fields = buildNewProductFields(patch);
  if (Object.keys(fields).length > 0) {
    await graphFetch(`${listPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  }
  const updated = await getNewProductWorksheet(id);
  if (!updated) throw new Error(`Worksheet ${id} disappeared after saving`);
  return updated;
}

// -----------------------------------------------------------------------------
// Watchers and the discussion (Ray, 2026-10-13)
// -----------------------------------------------------------------------------

function mockReplace(id: number, update: (w: NewProductWorksheet) => NewProductWorksheet): Promise<NewProductWorksheet> {
  const idx = pricingMockDb.worksheets.findIndex((w) => w.id === id);
  if (idx < 0) throw new Error(`Worksheet ${id} not found`);
  pricingMockDb.worksheets[idx] = { ...update(pricingMockDb.worksheets[idx]), modifiedAt: new Date().toISOString() };
  return mockDelay(pricingMockClone(pricingMockDb.worksheets[idx]));
}

/** Replace the Watchers list. Refused when nobody in a non-empty list resolves. */
export async function setWorksheetWatchers(id: number, people: Person[]): Promise<NewProductWorksheet> {
  if (USE_MOCK) return mockReplace(id, (w) => ({ ...w, watchers: people.map((p) => ({ ...p })) }));
  const resolved = await resolvePeopleLookupIds(SITES.salesTeam, SP_SALESTEAM_SITE_URL, people);
  if (people.length > 0 && !resolved.some((p) => p.lookupId)) {
    throw new Error("Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.");
  }
  await graphFetch(`${listPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(multiPersonField("Watchers", resolved)) });
  const updated = await getNewProductWorksheet(id);
  if (!updated) throw new Error(`Worksheet ${id} disappeared after saving`);
  return updated;
}

export interface WorksheetCommentInput {
  authorName: string;
  authorEmail: string;
  bodyHtml: string;
}

/** Re-read Communication, rebuild, write back — never a stale thread. */
async function rewriteCommunication(id: number, change: (raw: string) => string): Promise<NewProductWorksheet> {
  const existing = await graphFetch<GraphListItem>(`${listPath()}/${id}?$expand=fields($select=Communication)`);
  const raw = (existing.fields?.Communication as string | undefined) ?? "";
  await graphFetch(`${listPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify({ Communication: change(raw) }) });
  const updated = await getNewProductWorksheet(id);
  if (!updated) throw new Error(`Worksheet ${id} disappeared after saving`);
  return updated;
}

export async function addWorksheetComment(id: number, comment: WorksheetCommentInput): Promise<NewProductWorksheet> {
  const timestamp = new Date();
  if (USE_MOCK) return mockReplace(id, (w) => ({ ...w, comments: [{ ...comment, timestamp, attachments: [] }, ...w.comments] }));
  return rewriteCommunication(id, (raw) => appendComment(raw, { ...comment, timestamp }));
}

export async function editWorksheetComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<NewProductWorksheet> {
  if (USE_MOCK) {
    return mockReplace(id, (w) => ({
      ...w,
      comments: w.comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() && c.authorEmail.toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
    }));
  }
  return rewriteCommunication(id, (raw) => replaceComment(raw, target, newBodyHtml));
}