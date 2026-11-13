import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PMO_SITE_URL, SP_SUPPLIERS_LIST_ID, USE_MOCK } from "./config";
import {
  ensureLookupIds,
  listSiteUserDirectory,
  resolvePeopleLookupIds,
  resolvePersonLookupId,
} from "./siteUsers";
import { autoWatchers } from "@/lib/people";
import { deleteAttachment, uploadAttachment } from "./attachments";
import type { GraphListItem, Person, Supplier, SupplierInput } from "@/types/task";
import {
  attachSupplierPeople,
  buildSupplierCreateFields,
  compareSuppliers,
  parseSupplierLogo,
  supplierDetailsPatch,
  toSupplier,
} from "@/lib/supplierMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { annotateMultiChoiceFields, multiPersonField } from "@/lib/graphFields";
import { MOCK_SUPPLIERS } from "@/data/srmMockData";
import { mockDelay } from "./mockLatency";

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
  // Both halves of every SINGLE-value person/lookup column (AssignedBuyer,
  // PointofContact): Graph hands those back as a bare `<Name>LookupId` and
  // asking for the friendly name alone means the id never arrives — the same
  // trap that hid every supplier contact until 2026-09-09.
  //
  // `QualityPeformance` is "Logistical Performance" (the missing R is real)
  // and `QualityPerformance` is "Quality Performance". Both are needed.
  "Title,CompanyName,BusinessPartnerNumber,Address,Website,SupplierScore," +
  "CoreCompetency,Status,PrimarySupplyFocus,PanelsOnly,Notes," +
  "AssignedBuyer,AssignedBuyerLookupId,SupplierIdentifier,Watchers," +
  "PointofContact,PointofContactLookupId," +
  "AllDeliveries,SupplierPerformanceRate,QualityPeformance,QualityPerformance," +
  "Logo,Communication,Attachments,Created,Modified";

/**
 * Suppliers List multi-choice columns (`displayAs: "checkBoxes"`, confirmed
 * live 2026-09-24). `Status` is SINGLE-value and deliberately absent.
 *
 * `PrimarySupplyFocus` IS a checkBoxes column in SharePoint, but its choice
 * list is still the placeholder `["Choice"]` and ARC reads/writes it as a
 * plain string (see CLAUDE.md) — so it is annotated only when a caller
 * actually sends an array, which `annotateMultiChoiceFields` already handles.
 */
const SUPPLIER_MULTI_CHOICE_FIELDS = ["CoreCompetency", "PrimarySupplyFocus"] as const;

export async function listSuppliers(): Promise<Supplier[]> {
  if (USE_MOCK) {
    return mockDelay([...mockStore].sort(compareSuppliers).map((s) => ({ ...s })));
  }
  const listId = requireListId("load suppliers");
  // The PMO site directory names an Assigned Buyer that arrives as a bare
  // lookupId. Read in parallel and BEST-EFFORT: a refused directory read
  // degrades a buyer to "User #n", never loses the whole list.
  const [items, siteUsers] = await Promise.all([
    graphFetchAll<GraphListItem>(
      `/sites/${SITES.pmo}/lists/${listId}/items?$expand=fields($select=${SELECT})&$top=999`,
    ),
    listSiteUserDirectory(SITES.pmo).catch(() => new Map<number, Person>()),
  ]);
  const suppliers = items.map(toSupplier);
  attachSupplierPeople(suppliers, siteUsers);
  return suppliers.sort(compareSuppliers);
}

export async function getSupplier(id: number): Promise<Supplier | null> {
  if (USE_MOCK) {
    const found = mockStore.find((s) => s.id === id);
    return mockDelay(found ? { ...found } : null);
  }
  // A 404 is a real answer; anything else must propagate. Swallowing every
  // failure into null made a refused or throttled re-read AFTER a successful
  // write report "disappeared after update" and roll the change off screen.
  const [item, siteUsers] = await Promise.all([
    graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=${SELECT})`).catch(
      (err: unknown) => {
        if (isNotFound(err)) return null;
        throw err;
      },
    ),
    listSiteUserDirectory(SITES.pmo).catch(() => new Map<number, Person>()),
  ]);
  if (!item) return null;
  const supplier = toSupplier(item);
  attachSupplierPeople([supplier], siteUsers);
  return supplier;
}

function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return true;
  return /\b404\b|itemNotFound/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * The Assigned Buyer's PMO-site lookupId — Graph first, `ensureuser` second —
 * or a refusal. Sending `null` for a buyer somebody picked is what this used
 * to do (`ensurePersonLookupId(...)?.lookupId ?? null`): SharePoint accepts
 * it, so the column was cleared with no error anywhere.
 */
async function resolveAssignedBuyer(person: Person | null): Promise<Person | null> {
  if (!person) return null;
  const resolved = await resolvePersonLookupId(SITES.pmo, SP_PMO_SITE_URL, person);
  if (resolved?.lookupId) return resolved;
  throw new Error(
    `Couldn't set Assigned Buyer to ${person.displayName || person.email || "that person"}: ` +
      `SharePoint has no user record for them on the PMO site, and one couldn't be created. ` +
      `Ask an admin to check your SharePoint access, then try again.`,
  );
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const [assignedBuyer, watchers] = await Promise.all([
    resolveAssignedBuyer(input.assignedBuyer),
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
      primarySupplyFocus: input.primarySupplyFocus.trim(),
      panelsOnly: input.panelsOnly,
      notes: "",
      assignedBuyer,
      supplierIdentifier: "",
      watchers,
      pointOfContactId: null,
      allDeliveries: null,
      supplierPerformanceRate: null,
      logisticalPerformance: null,
      qualityPerformance: null,
      logo: null,
      comments: [],
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [supplier, ...mockStore];
    return mockDelay(supplier);
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

/**
 * Patch the Assigned Buyer. A newly assigned buyer also becomes a WATCHER, in
 * the SAME PATCH, so the two columns can't disagree — the house rule for every
 * assign path (see "Creators and assignees watch what they're involved in").
 * The watchers are re-read from SharePoint first, so one added elsewhere since
 * the page loaded isn't clobbered. Clearing the buyer removes nobody.
 */
export async function updateSupplierAssignedBuyer(
  id: number,
  person: Person | null,
): Promise<Supplier> {
  const resolved = await resolveAssignedBuyer(person);
  if (!resolved) {
    if (USE_MOCK) return updateSupplierFields(id, { AssignedBuyer: null });
    return updateSupplierFields(id, { AssignedBuyerLookupId: null });
  }
  const current = await getSupplier(id);
  const watchers = autoWatchers(current?.watchers, resolved);
  // Mock mode keeps the whole person, so the picker can match it back by
  // email; a bare lookupId there rendered as "No buyer assigned".
  if (USE_MOCK) return updateSupplierFields(id, { AssignedBuyer: resolved, Watchers: watchers });
  const resolvedWatchers = await resolvePeopleLookupIds(SITES.pmo, SP_PMO_SITE_URL, watchers);
  return updateSupplierFields(id, {
    AssignedBuyerLookupId: resolved.lookupId,
    ...multiPersonField("Watchers", resolvedWatchers),
  });
}

/** Patch the Point of Contact — a single lookup into Supplier Contacts. */
export async function updateSupplierPointOfContact(
  id: number,
  contactId: number | null,
): Promise<Supplier> {
  return updateSupplierFields(id, { PointofContactLookupId: contactId });
}

/**
 * Replace a supplier's Logo. The `Logo` column is a modern SharePoint
 * "Image" column with no write API of its own — Graph exposes no column
 * type for it at all (see supplierMapper.ts) — but its real stored value,
 * confirmed against live sample rows, is JSON naming a reserved (hidden)
 * attachment on the SAME item:
 *   {"fileName":"Reserved_ImageAttachment_...","originalImageName":"..."}
 * So writing one is: upload the file as an ordinary list-item attachment —
 * the same `_api/AttachmentFiles` endpoint every other attachment in ARC
 * already uses — under a `Reserved_ImageAttachment_` name (so it's excluded
 * from the generic attachments list, same as `isReservedImageAttachment`
 * already assumes), then PATCH `Logo` to point at it.
 *
 * Order matters: the NEW attachment is uploaded and the field repointed
 * FIRST; the old backing attachment (if any) is deleted best-effort AFTER,
 * so a failed upload never leaves `Logo` pointing at a file that's gone.
 *
 * This is unverified against SharePoint's own native rendering of an Image
 * column — there's no documented write contract for one, and this shape is
 * inferred from what the column already held rather than a documented API.
 * It doesn't need to be verified against that, though: ARC only ever reads
 * this value back through `parseSupplierLogo` / `SupplierLogo.tsx`, which is
 * exactly this shape, so ARC's own display works regardless of whether
 * SharePoint's list UI also shows the update as a thumbnail.
 */
export async function updateSupplierLogo(current: Supplier, file: File): Promise<Supplier> {
  const reservedName = `Reserved_ImageAttachment_${Date.now()}_${file.name}`;
  const renamed = new File([file], reservedName, { type: file.type });
  const uploaded = await uploadAttachment("supplier", current.id, renamed);

  const updated = await updateSupplierFields(current.id, {
    Logo: JSON.stringify({ fileName: uploaded.fileName, originalImageName: file.name }),
  });

  if (current.logo && current.logo.fileName !== uploaded.fileName) {
    try {
      await deleteAttachment("supplier", current.id, current.logo.fileName);
    } catch (err) {
      console.error(
        `updateSupplierLogo: uploaded the new logo but couldn't remove the old attachment "${current.logo.fileName}"`,
        err,
      );
    }
  }

  return updated;
}

/** Clear a supplier's Logo — empties the column and best-effort removes its backing attachment. */
export async function clearSupplierLogo(current: Supplier): Promise<Supplier> {
  const updated = await updateSupplierFields(current.id, { Logo: null });
  if (current.logo) {
    try {
      await deleteAttachment("supplier", current.id, current.logo.fileName);
    } catch (err) {
      console.error(
        `clearSupplierLogo: cleared the Logo field but couldn't remove the old attachment "${current.logo.fileName}"`,
        err,
      );
    }
  }
  return updated;
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
    return mockDelay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(annotateMultiChoiceFields(fields, SUPPLIER_MULTI_CHOICE_FIELDS)),
  });
  const updated = await getSupplier(id);
  if (!updated) throw new Error(`Supplier ${id} disappeared after update`);
  return updated;
}

/** A number column's mock write: a real number, or null for a cleared box. */
function toMockNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
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
  if ("PrimarySupplyFocus" in fields)
    next.primarySupplyFocus = String(fields.PrimarySupplyFocus ?? "");
  if ("PanelsOnly" in fields) next.panelsOnly = fields.PanelsOnly === true;
  // The four NUMBER columns. `null` is preserved as null — a cleared score
  // is "never recorded", not zero — so these deliberately don't `?? 0`.
  if ("SupplierPerformanceRate" in fields)
    next.supplierPerformanceRate = toMockNumber(fields.SupplierPerformanceRate);
  if ("QualityPerformance" in fields)
    next.qualityPerformance = toMockNumber(fields.QualityPerformance);
  // "Logistical Performance" — the misspelled column is the right one.
  if ("QualityPeformance" in fields)
    next.logisticalPerformance = toMockNumber(fields.QualityPeformance);
  if ("AllDeliveries" in fields) next.allDeliveries = toMockNumber(fields.AllDeliveries);
  if ("AssignedBuyer" in fields) next.assignedBuyer = (fields.AssignedBuyer as Person | null) ?? null;
  if ("AssignedBuyerLookupId" in fields) {
    const lookupId = fields.AssignedBuyerLookupId;
    next.assignedBuyer = typeof lookupId === "number" ? { displayName: "", lookupId } : null;
  }
  if ("PointofContactLookupId" in fields) {
    const lookupId = fields.PointofContactLookupId;
    next.pointOfContactId = typeof lookupId === "number" ? lookupId : null;
  }
  if ("Logo" in fields) next.logo = parseSupplierLogo(fields.Logo);
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
    return mockDelay({ ...next });
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
    return mockDelay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateSupplierFields(id, { Communication: replaceComment(existingRaw, target, newBodyHtml) });
}
