import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PMO_SITE_URL, SP_SUPPLIERS_LIST_ID, USE_MOCK } from "./config";
import { ensureLookupIds, ensurePersonLookupId } from "./siteUsers";
import type { GraphListItem, Person, Supplier, SupplierInput } from "@/types/task";
import {
  buildSupplierCreateFields,
  compareSuppliers,
  supplierDetailsPatch,
  toSupplier,
} from "@/lib/supplierMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { MOCK_SUPPLIERS } from "@/data/srmMockData";

// =============================================================================
// "Suppliers List" — the SRM tool's anchor list, on the PMO site. Supplier
// Contacts and Supplier Issue Tracker both carry a `BPReference` lookup back
// to a row here.
//
// No delete: a supplier record is a maintained register (531 rows at
// discovery, still growing), and it's the anchor for two other lists' data —
// removing one would orphan every contact and issue pointing at it. Setting
// Status to "Archive" or "Phase Out" is how a supplier goes away without
// breaking those links.
// =============================================================================

let mockStore: Supplier[] = MOCK_SUPPLIERS.map((s) => ({ ...s }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_SUPPLIERS_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_SUPPLIERS_LIST_ID is not set.`);
  }
  return SP_SUPPLIERS_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.pmo}/lists/${requireListId("reach the supplier")}/items/${id}`;
}

const SELECT =
  "Title,CompanyName,BusinessPartnerNumber,Address,Website,SupplierScore,CoreCompetency,Status,Notes,AssignedBuyer,SupplierIdentifier,Watchers,PointofContact,AllDeliveries,SupplierPerformanceRate,QualityPeformance,QualityPerformance,Communication,Attachments,Created,Modified";

export async function listSuppliers(): Promise<Supplier[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareSuppliers).map((s) => ({ ...s })));
  }
  const listId = requireListId("load suppliers");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items?$expand=fields($select=${SELECT})&$top=999`,
  );
  return items.map(toSupplier).sort(compareSuppliers);
}

export async function getSupplier(id: number): Promise<Supplier | null> {
  if (USE_MOCK) {
    const found = mockStore.find((s) => s.id === id);
    return delay(found ? { ...found } : null);
  }
  try {
    const item = await graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=${SELECT})`);
    return toSupplier(item);
  } catch {
    return null;
  }
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const [assignedBuyer, watchers] = await Promise.all([
    ensurePersonLookupId(SP_PMO_SITE_URL, input.assignedBuyer),
    ensureLookupIds(SP_PMO_SITE_URL, input.watchers),
  ]);

  if (USE_MOCK) {
    const now = new Date();
    const supplier: Supplier = {
      id: Math.max(0, ...mockStore.map((s) => s.id)) + 1,
      title:
        input.businessPartnerNumber.trim() && input.companyName.trim()
          ? `${input.businessPartnerNumber.trim()}-${input.companyName.trim()}`
          : input.companyName.trim() || input.businessPartnerNumber.trim(),
      companyName: input.companyName.trim(),
      businessPartnerNumber: input.businessPartnerNumber.trim(),
      address: input.address.trim(),
      website: input.website.trim(),
      supplierScore: "",
      coreCompetencies: [],
      status: input.status,
      notes: "",
      assignedBuyer,
      supplierIdentifier: "",
      watchers,
      pointOfContactId: null,
      allDeliveries: null,
      supplierPerformanceRate: null,
      logisticalPerformance: null,
      qualityPerformance: null,
      comments: [],
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [supplier, ...mockStore];
    return delay(supplier);
  }

  const listId = requireListId("create the supplier");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items`,
    {
      method: "POST",
      body: JSON.stringify({ fields: buildSupplierCreateFields(input, { assignedBuyer, watchers }) }),
    },
  );
  return (await getSupplier(parseInt(created.id, 10))) ?? toSupplier(created);
}

/** Patch the Details card — only the changed keys, plus a recomputed Title when either half changes. */
export async function updateSupplierDetails(
  current: Supplier,
  changed: Parameters<typeof supplierDetailsPatch>[1],
): Promise<Supplier> {
  return updateSupplierFields(current.id, supplierDetailsPatch(current, changed));
}

/** Patch the Assigned Buyer, resolving a newly-picked person's lookupId. */
export async function updateSupplierAssignedBuyer(
  id: number,
  person: Person | null,
): Promise<Supplier> {
  const ensured = await ensurePersonLookupId(SP_PMO_SITE_URL, person);
  return updateSupplierFields(id, { AssignedBuyerLookupId: ensured?.lookupId ?? null });
}

/** Patch the Point of Contact — a single lookup into Supplier Contacts. */
export async function updateSupplierPointOfContact(
  id: number,
  contactId: number | null,
): Promise<Supplier> {
  return updateSupplierFields(id, { PointofContactLookupId: contactId });
}

export async function setSupplierWatchers(id: number, people: Person[]): Promise<Supplier> {
  if (USE_MOCK) {
    return updateSupplierFields(id, { Watchers: people });
  }
  const ensured = await ensureLookupIds(SP_PMO_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updateSupplierFields(id, multiPersonField("Watchers", ensured));
}

async function updateSupplierFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<Supplier> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Supplier ${id} not found`);
    const next: Supplier = { ...mockStore[idx], modifiedAt: new Date() };
    applyMockFields(next, fields);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const updated = await getSupplier(id);
  if (!updated) throw new Error(`Supplier ${id} disappeared after update`);
  return updated;
}

function applyMockFields(next: Supplier, fields: Record<string, unknown>) {
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("CompanyName" in fields) next.companyName = String(fields.CompanyName ?? "");
  if ("BusinessPartnerNumber" in fields)
    next.businessPartnerNumber = String(fields.BusinessPartnerNumber ?? "");
  if ("Address" in fields) next.address = String(fields.Address ?? "");
  if ("Website" in fields) next.website = String(fields.Website ?? "");
  if ("Status" in fields) next.status = (fields.Status as Supplier["status"]) ?? null;
  if ("SupplierScore" in fields) next.supplierScore = String(fields.SupplierScore ?? "");
  if ("Notes" in fields) next.notes = String(fields.Notes ?? "");
  if ("SupplierIdentifier" in fields) next.supplierIdentifier = String(fields.SupplierIdentifier ?? "");
  if ("CoreCompetency" in fields)
    next.coreCompetencies = (fields.CoreCompetency as Supplier["coreCompetencies"]) ?? [];
  if ("AssignedBuyerLookupId" in fields) {
    const lookupId = fields.AssignedBuyerLookupId;
    next.assignedBuyer = typeof lookupId === "number" ? { displayName: "", lookupId } : null;
  }
  if ("PointofContactLookupId" in fields) {
    const lookupId = fields.PointofContactLookupId;
    next.pointOfContactId = typeof lookupId === "number" ? lookupId : null;
  }
  if (Array.isArray(fields.Watchers)) {
    next.watchers = fields.Watchers as Person[];
  } else {
    const watcherIds = fields["WatchersLookupId"];
    if (Array.isArray(watcherIds)) {
      next.watchers = watcherIds.map((lookupId: number) => ({ displayName: "", lookupId }));
    }
  }
}

/** Append a comment to the supplier's Communication field. */
export async function addSupplierComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<Supplier> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Supplier ${id} not found`);
    const next: Supplier = {
      ...mockStore[idx],
      comments: [
        { timestamp: new Date(), authorName: comment.authorName, authorEmail: comment.authorEmail, bodyHtml: comment.bodyHtml, attachments: [] },
        ...mockStore[idx].comments,
      ],
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateSupplierFields(id, { Communication: appendComment(existingRaw, comment) });
}

export async function editSupplierComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<Supplier> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`Supplier ${id} not found`);
    const next: Supplier = {
      ...mockStore[idx],
      comments: mockStore[idx].comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateSupplierFields(id, { Communication: replaceComment(existingRaw, target, newBodyHtml) });
}
