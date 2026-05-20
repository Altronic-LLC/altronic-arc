import { graphFetch, graphFetchAll } from "./graph";
import { SP_EIRS_LIST_ID, SP_SITE_ID, USE_MOCK } from "./config";
import type {
  Eir,
  GraphListItem,
  Person,
  ProjectReference,
} from "@/types/task";
import { attachEirReferences, toEir } from "@/lib/eirMapper";
import { multiPersonField } from "@/lib/graphFields";
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

  // Use $select with the LookupId-suffixed form of the project-reference
  // column. Without $select, Graph returns the column under its bare name
  // (`ProjectReference`) but doesn't expand the lookup id — the value just
  // isn't there to read. Requesting `ProjectReferenceLookupId` explicitly
  // forces Graph to materialise the lookup id as a number on the field bag.
  // We list every column we touch in toEir() so payloads stay lean.
  const select = [
    "Title",
    "EIRNo",
    "Description",
    "ProjectReferenceLookupId",
    "Priority",
    "Reporter",
    "ReporterLookupId",
    "Resolution",
    "AssignedEngineer",
    "Status",
    "EngineeringResponse",
    "WhereUsed",
    "EAU",
    "CurrentStock",
    "Watchers",
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
    "RequestType",
    "TaskReference",
    "TaskPromotedFlag",
    "EIRMeetingRelevant",
    "BuyerCode",
    "Attachments",
  ].join(",");
  const path =
    `/sites/${SP_SITE_ID}/lists/${SP_EIRS_LIST_ID}` +
    `/items?$expand=fields($select=${select})&$top=200`;
  const [items, projects] = await Promise.all([
    graphFetchAll<GraphListItem>(path),
    listProjects(),
  ]);

  // Round-two diagnostic. Last round confirmed the field comes back under
  // the bare key `ProjectReference`, but we still don't know what shape
  // its VALUE has — that's what blocks the lookup join. Print the value,
  // its type, and a sibling Reporter value for comparison (we know
  // ReporterLookupId works, so it's a useful reference).
  if (items.length > 0 && !diagnosticsLogged) {
    diagnosticsLogged = true;
    const fields = (items[0].fields ?? {}) as Record<string, unknown>;
    /* eslint-disable no-console */
    console.groupCollapsed("[EIR DEBUG] project-ref value diagnostic (round 2)");
    console.log("Field keys returned:", Object.keys(fields).sort());
    console.log("ProjectReferenceLookupId VALUE:", fields["ProjectReferenceLookupId"]);
    console.log("ProjectReference VALUE:", fields["ProjectReference"]);
    console.log("Sibling ReporterLookupId VALUE:", fields["ReporterLookupId"]);
    console.log("First 5 projects from listProjects():", projects.slice(0, 5));
    console.log(
      "Resolved parentProject after mapping:",
      toEir(items[0]).parentProject,
    );
    console.groupEnd();
    /* eslint-enable no-console */
  }

  const eirs = items.map(toEir);
  attachEirReferences(eirs, projects);
  return eirs;
}

// Module-level flag so the diagnostic prints once per session.
let diagnosticsLogged = false;

export async function getEir(id: number): Promise<Eir | null> {
  const all = await listEirs();
  return all.find((e) => e.id === id) ?? null;
}

export interface CreateEirInput {
  title: string;
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
  requestedCompletionDate?: Date | null;
}

export async function createEir(input: CreateEirInput): Promise<Eir> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((e) => e.id)) + 1;
    const now = new Date();
    const eir: Eir = {
      id: nextId,
      eirNo: `EIR-${now.getFullYear()}-${String(1000 + nextId).slice(-4)}`,
      title: input.title,
      description: input.description ?? "",
      requestType: input.requestType ?? "EIR",
      status: input.status ?? "Under Review",
      resolution: input.resolution ?? "Pending",
      requestedPriority: input.requestedPriority ?? null,
      reporter: input.reporter ?? null,
      assignedEngineers: input.assignedEngineers ?? [],
      watchers: input.watchers ?? [],
      parentProject: input.parentProjectLookupId
        ? { lookupId: input.parentProjectLookupId, title: "" }
        : null,
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
      ltbDate: null,
      priorityDate: null,
      priorityNumber: null,
      priorityCount: null,
      technicalPriority: null,
      riskPart: null,
      riskPartLevel: null,
      eirMeetingRelevant: null,
      buyerCode: "",
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
  if (input.description) fields.Description = input.description;
  if (input.requestType) fields.RequestType = input.requestType;
  if (input.status) fields.Status = input.status;
  if (input.resolution) fields.Resolution = input.resolution;
  if (input.requestedPriority) fields.Priority = input.requestedPriority;
  if (input.parentProjectLookupId) {
    fields.ProjectReferenceLookupId = input.parentProjectLookupId;
  }
  if (input.reporter?.lookupId) fields.ReporterLookupId = input.reporter.lookupId;
  if (input.assignedEngineers?.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("AssignedEngineer", input.assignedEngineers));
  }
  if (input.watchers?.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", input.watchers));
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
  if (input.requestedCompletionDate)
    fields.Requested_x0020_Completion_x0020 =
      input.requestedCompletionDate.toISOString();

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
    if ("BuyerCode" in fields) next.buyerCode = (fields.BuyerCode as string) ?? "";
    if ("Requested_x0020_Completion_x0020" in fields) {
      const v = fields.Requested_x0020_Completion_x0020;
      next.requestedCompletionDate = v ? new Date(v as string) : null;
    }
    if ("LTBDate" in fields) {
      const v = fields.LTBDate;
      next.ltbDate = v ? new Date(v as string) : null;
    }
    if ("ProjectReferenceLookupId" in fields) {
      const v = fields.ProjectReferenceLookupId;
      next.parentProject = v ? { lookupId: Number(v), title: next.parentProject?.title ?? "" } : null;
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
  const resolved = people.filter((p) => !!p.lookupId);
  if (people.length > 0 && resolved.length === 0) {
    throw new Error(
      "Cannot update Assigned Engineer: none of the selected people had a resolved lookupId.",
    );
  }
  return updateEirFields(id, multiPersonField("AssignedEngineer", people));
}

/** Replace the Watchers list. */
export async function setEirWatchers(id: number, people: Person[]): Promise<Eir> {
  if (USE_MOCK) {
    return updateEirFields(id, { Watchers: people });
  }
  const resolved = people.filter((p) => !!p.lookupId);
  if (people.length > 0 && resolved.length === 0) {
    throw new Error("Cannot update Watchers: none of the selected people had a resolved lookupId.");
  }
  return updateEirFields(id, multiPersonField("Watchers", people));
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
  return updateEirFields(id, { ReporterLookupId: person?.lookupId ?? null });
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
