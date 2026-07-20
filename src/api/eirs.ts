import { graphFetch, graphFetchAll } from "./graph";
import { SP_EIRS_LIST_ID, SP_SITE_ID, SP_SITE_URL, USE_MOCK } from "./config";
import { ensureLookupIds, ensurePersonLookupId } from "./siteUsers";
import type {
  Eir,
  GraphListItem,
  Person,
  ProjectReference,
} from "@/types/task";
import { attachEirReferences, toEir } from "@/lib/eirMapper";
import { multiLookupField, multiPersonField } from "@/lib/graphFields";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { listProjects } from "./tasks";
import { MOCK_EIRS } from "@/data/mockData";

// =============================================================================
// EIRs API — mirrors src/api/tasks.ts in shape. Mock + real branches,
// trimmed $select on the column list for perf.
// =============================================================================

const MOCK_STORAGE_KEY = "aets:mock-eirs-v1";

function loadFromStorage(): Eir[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Eir[];
    return parsed.map((e) => ({
      ...e,
      createdAt: new Date(e.createdAt),
      modifiedAt: new Date(e.modifiedAt),
      requestedCompletionDate: e.requestedCompletionDate ? new Date(e.requestedCompletionDate) : null,
      ltbDate: e.ltbDate ? new Date(e.ltbDate) : null,
      priorityDate: e.priorityDate ? new Date(e.priorityDate) : null,
      comments: (e.comments ?? []).map((c) => ({
        ...c,
        timestamp: new Date(c.timestamp),
        attachments: c.attachments ?? [],
      })),
    }));
  } catch {
    return null;
  }
}

function saveToStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(mockStore));
  } catch {
    // Quota / private mode — non-fatal.
  }
}

let mockStore: Eir[] = loadFromStorage() ?? [...MOCK_EIRS];

function delay<T>(value: T, ms = 100): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export async function listEirs(): Promise<Eir[]> {
  if (USE_MOCK) {
    const projects = (await listProjects()) as ProjectReference[];
    return delay(
      attachEirReferences(
        mockStore.map((e) => ({ ...e })),
        projects,
      ),
    );
  }
  if (!SP_EIRS_LIST_ID) {
    console.warn(
      "VITE_SP_EIRS_LIST_ID is not set — EIRs view will be empty.",
    );
    return [];
  }

  // Explicit $select with the actual column internal names we confirmed
  // via the earlier diagnostic. The key things this restores vs the
  // no-$select approach:
  //   - `Reporter` expands to a person object ({LookupId, LookupValue,
  //     Email}); without $select Graph only returns ReporterLookupId
  //     (just an int), so the sidebar showed "No reporter" on every EIR.
  //   - Same fix for AssignedEngineer + Watchers.
  //   - `ProjectReference` (multi-choice text) is included by its bare
  //     column name, NOT the *LookupId variant which doesn't exist here.
  const select = [
    "Title",
    "EIRNo",
    "Description",
    "RequestType",
    "Status",
    "Resolution",
    "Priority",
    "Reporter",
    "ReporterLookupId",
    "AssignedEngineer",
    "Watchers",
    "ProjectReference",
    "ProjectReferenceLookupId",
    "EngineeringResponse",
    "WhereUsed",
    "EAU",
    "CurrentStock",
    "MFG",
    "MFGP_x002f_N",
    "Communication",
    "Current_x0020_Price",
    "Altronic_x0020_Part_x0020_Number",
    "Requested_x0020_Completion_x0020",
    "Priority0",
    "PriorityDate",
    "PriorityCount",
    "RiskPart",
    "RiskPartLevel",
    "TechnicalPriority",
    "LTBDate",
    "TaskReference",
    "TaskPromotedFlag",
    "EIRMeetingRelevant",
    "BuyerCode",
    "Attachments",
  ].join(",");
  const path =
    `/sites/${SP_SITE_ID}/lists/${SP_EIRS_LIST_ID}` +
    `/items?$expand=fields($select=${select})&$top=200`;
  const [items, projects, siteUsers] = await Promise.all([
    graphFetchAll<GraphListItem>(path),
    listProjects(),
    // Best-effort: pull the SharePoint User Information List so we can
    // resolve Reporter LookupIds (and anyone else who only came back as
    // a bare id) to a real display name. If the call fails (permissions,
    // odd list name on the tenant, etc.) we fall through with no
    // directory — the cross-pollination from peers still does what it
    // can, and the placeholder "User #N" shows up only as a last resort.
    listSiteUsers().catch(() => []),
  ]);

  // One-time Reporter-shape diagnostic. The single-person Reporter column
  // sometimes comes back expanded, sometimes just as a bare LookupId —
  // log both so we can confirm the mapper is reaching for the right key.
  if (items.length > 0 && !reporterDebugLogged) {
    reporterDebugLogged = true;
    const f = (items[0].fields ?? {}) as Record<string, unknown>;
    /* eslint-disable no-console */
    console.group("%c[EIR DEBUG] Reporter shape", "color:#CB2C30;font-weight:bold");
    console.log("Reporter (object?):", f.Reporter);
    console.log("ReporterLookupId (int?):", f.ReporterLookupId);
    console.log("First EIR id:", items[0].id);
    console.log("After mapping → reporter:", toEir(items[0]).reporter);
    console.groupEnd();
    /* eslint-enable no-console */
  }

  const eirs = items.map(toEir);
  attachEirReferences(eirs, projects, siteUsers);
  return eirs;
}

/**
 * Fetch the SharePoint User Information List — the hidden system list
 * that holds every user who's ever been referenced on the site. Returns
 * a Person[] keyed by SP lookupId. Used to resolve Reporter / Author /
 * Watcher entries that only came back as bare lookupIds.
 *
 * Exported for reuse by other Engineering-site modules with single-person
 * columns (Build Requests' Requestor / EngineerAssigned have the same
 * bare-LookupId limitation).
 *
 * Throws on any 4xx/5xx so callers can `.catch(() => [])` and degrade.
 */
export async function listSiteUsers(): Promise<Person[]> {
  // Graph accepts the list's display name (URL-encoded) as the list
  // identifier on the /lists/{id} endpoint. The hidden list's title is
  // "User Information List" on every modern SP site.
  const path =
    `/sites/${SP_SITE_ID}/lists/User%20Information%20List/items` +
    `?$expand=fields($select=Title,EMail)&$top=500`;
  const items = await graphFetchAll<GraphListItem>(path);
  const people: Person[] = [];
  for (const it of items) {
    const f = it.fields ?? {};
    const displayName = ((f.Title as string) ?? "").trim();
    const email = ((f.EMail as string) ?? "").trim();
    const lookupId = parseInt(it.id, 10);
    if (!displayName || Number.isNaN(lookupId)) continue;
    people.push({
      displayName,
      lookupId,
      email: email || undefined,
    });
  }
  return people;
}

let reporterDebugLogged = false;

export async function getEir(id: number): Promise<Eir | null> {
  const all = await listEirs();
  return all.find((e) => e.id === id) ?? null;
}

export interface CreateEirInput {
  title: string;
  /** Pre-computed "EIR No" (EIR_YYYY-####). Written to the EIRNo column. */
  eirNo?: string;
  description?: string;
  parentProjectLookupId?: number | null;
  requestType?: "EIR" | "ECR" | "Temporary Deviation";
  status?: Eir["status"];
  resolution?: Eir["resolution"];
  requestedPriority?: Eir["requestedPriority"];
  reporter?: Person | null;
  assignedEngineers?: Person[];
  watchers?: Person[];
  taskReference?: string;
  whereUsed?: string;
  eau?: string;
  currentStock?: string;
  mfg?: string;
  mfgPartNumber?: string;
  currentPrice?: string;
  altronicPartNumber?: string;
  buyerCode?: string;
  riskPart?: Eir["riskPart"];
  riskPartLevel?: Eir["riskPartLevel"];
  technicalPriority?: Eir["technicalPriority"];
  requestedCompletionDate?: Date | null;
  ltbDate?: Date | null;
}

export async function createEir(input: CreateEirInput): Promise<Eir> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((e) => e.id)) + 1;
    const now = new Date();
    const eir: Eir = {
      id: nextId,
      eirNo: input.eirNo ?? `EIR_${now.getFullYear()}-${String(1000 + nextId).slice(-4)}`,
      title: input.title,
      description: input.description ?? "",
      requestType: input.requestType ?? "EIR",
      status: input.status ?? "Under Review",
      resolution: input.resolution ?? "Pending",
      requestedPriority: input.requestedPriority ?? null,
      reporter: input.reporter ?? null,
      assignedEngineers: input.assignedEngineers ?? [],
      watchers: input.watchers ?? [],
      parentProjects: input.parentProjectLookupId
        ? [{ lookupId: input.parentProjectLookupId, title: "" }]
        : [],
      taskReference: input.taskReference ?? "",
      engineeringResponse: "",
      whereUsed: input.whereUsed ?? "",
      eau: input.eau ?? "",
      currentStock: input.currentStock ?? "",
      mfg: input.mfg ?? "",
      mfgPartNumber: input.mfgPartNumber ?? "",
      currentPrice: input.currentPrice ?? "",
      altronicPartNumber: input.altronicPartNumber ?? "",
      requestedCompletionDate: input.requestedCompletionDate ?? null,
      ltbDate: input.ltbDate ?? null,
      priorityDate: null,
      priorityNumber: null,
      priorityCount: null,
      technicalPriority: input.technicalPriority ?? null,
      riskPart: input.riskPart ?? null,
      riskPartLevel: input.riskPartLevel ?? null,
      eirMeetingRelevant: null,
      buyerCode: input.buyerCode ?? "",
      taskPromotedFlag: false,
      createdAt: now,
      modifiedAt: now,
      author: input.reporter ?? null,
      comments: [],
      hasAttachments: false,
    };
    mockStore = [eir, ...mockStore];
    saveToStorage();
    return delay(eir);
  }

  if (!SP_EIRS_LIST_ID) {
    throw new Error("Cannot create EIR: VITE_SP_EIRS_LIST_ID is not set.");
  }

  const fields: Record<string, unknown> = { Title: input.title };
  if (input.eirNo) fields.EIRNo = input.eirNo;
  if (input.description) fields.Description = input.description;
  if (input.requestType) fields.RequestType = input.requestType;
  if (input.status) fields.Status = input.status;
  if (input.resolution) fields.Resolution = input.resolution;
  if (input.requestedPriority) fields.Priority = input.requestedPriority;
  if (input.parentProjectLookupId) {
    // EIR Project Reference is a multi-value Lookup column — same shape
    // as Tasks' Related Projects. Single-project create gets wrapped in
    // an array, with the `Collection(Edm.Int32)` annotation Graph
    // requires for multi-value lookup writes.
    Object.assign(fields, multiLookupField("ProjectReference", [input.parentProjectLookupId]));
  }
  // Resolve lookupIds (creating on demand) for directory-picked people.
  const reporter = await ensurePersonLookupId(SP_SITE_URL, input.reporter ?? null);
  if (reporter?.lookupId) fields.ReporterLookupId = reporter.lookupId;
  const engineers = input.assignedEngineers
    ? await ensureLookupIds(SP_SITE_URL, input.assignedEngineers)
    : [];
  if (engineers.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("AssignedEngineer", engineers));
  }
  const watchers = input.watchers ? await ensureLookupIds(SP_SITE_URL, input.watchers) : [];
  if (watchers.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", watchers));
  }
  if (input.taskReference) fields.TaskReference = input.taskReference;
  if (input.whereUsed) fields.WhereUsed = input.whereUsed;
  if (input.eau) fields.EAU = input.eau;
  if (input.currentStock) fields.CurrentStock = input.currentStock;
  if (input.mfg) fields.MFG = input.mfg;
  if (input.mfgPartNumber) fields.MFGP_x002f_N = input.mfgPartNumber;
  if (input.currentPrice) fields.Current_x0020_Price = input.currentPrice;
  if (input.altronicPartNumber)
    fields.Altronic_x0020_Part_x0020_Number = input.altronicPartNumber;
  if (input.buyerCode) fields.BuyerCode = input.buyerCode;
  if (input.riskPart) fields.RiskPart = input.riskPart;
  if (input.riskPartLevel) fields.RiskPartLevel = input.riskPartLevel;
  if (input.technicalPriority) fields.TechnicalPriority = input.technicalPriority;
  if (input.requestedCompletionDate)
    fields.Requested_x0020_Completion_x0020 =
      input.requestedCompletionDate.toISOString();
  if (input.ltbDate) fields.LTBDate = input.ltbDate.toISOString();

  const created = await graphFetch<GraphListItem>(
    `/sites/${SP_SITE_ID}/lists/${SP_EIRS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  return toEir(created);
}

export async function updateEirFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<Eir> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`EIR ${id} not found`);
    const next = { ...mockStore[idx], modifiedAt: new Date() };
    if ("Title" in fields) next.title = (fields.Title as string) ?? next.title;
    if ("Description" in fields) next.description = (fields.Description as string) ?? "";
    if ("Status" in fields) next.status = fields.Status as Eir["status"];
    if ("Resolution" in fields) next.resolution = fields.Resolution as Eir["resolution"];
    if ("RequestType" in fields) next.requestType = fields.RequestType as Eir["requestType"];
    if ("Priority" in fields) next.requestedPriority = fields.Priority as Eir["requestedPriority"];
    if ("EngineeringResponse" in fields) next.engineeringResponse = (fields.EngineeringResponse as string) ?? "";
    if ("WhereUsed" in fields) next.whereUsed = (fields.WhereUsed as string) ?? "";
    if ("EAU" in fields) next.eau = (fields.EAU as string) ?? "";
    if ("CurrentStock" in fields) next.currentStock = (fields.CurrentStock as string) ?? "";
    if ("MFG" in fields) next.mfg = (fields.MFG as string) ?? "";
    if ("MFGP_x002f_N" in fields) next.mfgPartNumber = (fields.MFGP_x002f_N as string) ?? "";
    if ("Current_x0020_Price" in fields) next.currentPrice = (fields.Current_x0020_Price as string) ?? "";
    if ("Altronic_x0020_Part_x0020_Number" in fields)
      next.altronicPartNumber = (fields.Altronic_x0020_Part_x0020_Number as string) ?? "";
    if ("TaskReference" in fields) next.taskReference = (fields.TaskReference as string) ?? "";
    if ("TaskPromotedFlag" in fields) next.taskPromotedFlag = !!fields.TaskPromotedFlag;
    if ("BuyerCode" in fields) next.buyerCode = (fields.BuyerCode as string) ?? "";
    if ("RiskPart" in fields) next.riskPart = (fields.RiskPart as Eir["riskPart"]) ?? null;
    if ("RiskPartLevel" in fields)
      next.riskPartLevel = (fields.RiskPartLevel as Eir["riskPartLevel"]) ?? null;
    if ("TechnicalPriority" in fields)
      next.technicalPriority = (fields.TechnicalPriority as Eir["technicalPriority"]) ?? null;
    if ("Requested_x0020_Completion_x0020" in fields) {
      const v = fields.Requested_x0020_Completion_x0020;
      next.requestedCompletionDate = v ? new Date(v as string) : null;
    }
    if ("LTBDate" in fields) {
      const v = fields.LTBDate;
      next.ltbDate = v ? new Date(v as string) : null;
    }
    if (
      "ProjectReferenceLookupId" in fields ||
      "ProjectReference" in fields
    ) {
      // Multi-value Lookup write — Graph receives an integer array
      // under `ProjectReferenceLookupId`. Mock store mirrors that.
      const raw =
        (fields.ProjectReferenceLookupId as unknown) ??
        (fields.ProjectReference as unknown);
      const ids: number[] = [];
      if (Array.isArray(raw)) {
        for (const x of raw) {
          if (typeof x === "number" && x > 0) ids.push(x);
          else if (typeof x === "string") {
            const n = parseInt(x, 10);
            if (!Number.isNaN(n) && n > 0) ids.push(n);
          }
        }
      } else if (typeof raw === "number" && raw > 0) {
        ids.push(raw);
      }
      next.parentProjects = ids.map((id) => ({ lookupId: id, title: "" }));
    }
    if ("ReporterLookupId" in fields) {
      const v = fields.ReporterLookupId;
      next.reporter = v ? { displayName: "(updating…)", lookupId: Number(v) } : null;
    }
    if ("AssignedEngineer" in fields && Array.isArray(fields.AssignedEngineer)) {
      next.assignedEngineers = fields.AssignedEngineer as Person[];
    }
    if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
      next.watchers = fields.Watchers as Person[];
    }
    if ("Communication" in fields) {
      // Communication is normally written through addEirComment/editEirComment.
      // Mock mode keeps the parsed value separately so we don't drop it.
    }
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveToStorage();
    return delay(next);
  }

  if (!SP_EIRS_LIST_ID) {
    throw new Error("Cannot update EIR: VITE_SP_EIRS_LIST_ID is not set.");
  }

  await graphFetch(
    `/sites/${SP_SITE_ID}/lists/${SP_EIRS_LIST_ID}/items/${id}/fields`,
    { method: "PATCH", body: JSON.stringify(fields) },
  );
  const updated = await getEir(id);
  if (!updated) throw new Error(`EIR ${id} disappeared after update`);
  return updated;
}


/** Replace the Assigned Engineer list. */
export async function setEirAssignedEngineers(id: number, people: Person[]): Promise<Eir> {
  if (USE_MOCK) {
    return updateEirFields(id, { AssignedEngineer: people });
  }
  const ensured = await ensureLookupIds(SP_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Assigned Engineer: couldn't resolve a SharePoint user for any selected person.",
    );
  }
  return updateEirFields(id, multiPersonField("AssignedEngineer", ensured));
}

/** Replace the Watchers list. */
export async function setEirWatchers(id: number, people: Person[]): Promise<Eir> {
  if (USE_MOCK) {
    return updateEirFields(id, { Watchers: people });
  }
  const ensured = await ensureLookupIds(SP_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error("Cannot update Watchers: couldn't resolve a SharePoint user for any selected person.");
  }
  return updateEirFields(id, multiPersonField("Watchers", ensured));
}

/** Set the single-person Reporter field. */
export async function setEirReporter(id: number, person: Person | null): Promise<Eir> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`EIR ${id} not found`);
    mockStore[idx] = { ...mockStore[idx], reporter: person, modifiedAt: new Date() };
    saveToStorage();
    return delay({ ...mockStore[idx] });
  }
  const ensured = await ensurePersonLookupId(SP_SITE_URL, person);
  return updateEirFields(id, { ReporterLookupId: ensured?.lookupId ?? null });
}

/** Append a comment to the EIR's Communication field. */
export async function addEirComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<Eir> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`EIR ${id} not found`);
    const next = { ...mockStore[idx] };
    next.comments = [
      {
        timestamp: new Date(),
        authorName: comment.authorName,
        authorEmail: comment.authorEmail,
        bodyHtml: comment.bodyHtml,
        attachments: [],
      },
      ...next.comments,
    ];
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveToStorage();
    return delay({ ...next });
  }
  if (!SP_EIRS_LIST_ID) {
    throw new Error("Cannot post EIR comment: VITE_SP_EIRS_LIST_ID is not set.");
  }
  // Same read-modify-write trick as tasks: fetch existing Communication,
  // append the new record, PATCH the new string back.
  const path = `/sites/${SP_SITE_ID}/lists/${SP_EIRS_LIST_ID}/items/${id}?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = appendComment(existingRaw, comment);
  return updateEirFields(id, { Communication: newRaw });
}

export async function editEirComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<Eir> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`EIR ${id} not found`);
    const next = { ...mockStore[idx] };
    next.comments = next.comments.map((c) =>
      c.timestamp.getTime() === target.timestamp.getTime() &&
      (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
        ? { ...c, bodyHtml: newBodyHtml }
        : c,
    );
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveToStorage();
    return delay({ ...next });
  }
  if (!SP_EIRS_LIST_ID) {
    throw new Error("Cannot edit EIR comment: VITE_SP_EIRS_LIST_ID is not set.");
  }
  const path = `/sites/${SP_SITE_ID}/lists/${SP_EIRS_LIST_ID}/items/${id}?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = replaceComment(existingRaw, target, newBodyHtml);
  return updateEirFields(id, { Communication: newRaw });
}
