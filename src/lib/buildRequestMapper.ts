import type {
  BuildRequest,
  BuildRequestBlockedReason,
  BuildRequestDisposition,
  BuildRequestItem,
  BuildRequestLeadTime,
  BuildRequestPartStatus,
  BuildRequestPartType,
  BuildRequestSamplePhase,
  BuildRequestStatus,
  BuildRequestType,
  GraphListItem,
  Person,
  ProjectReference,
} from "@/types/task";
import {
  BUILD_REQUEST_BLOCKED_REASONS,
  BUILD_REQUEST_DISPOSITIONS,
  BUILD_REQUEST_LEAD_TIMES,
  BUILD_REQUEST_PART_STATUSES,
  BUILD_REQUEST_PART_TYPES,
  BUILD_REQUEST_SAMPLE_PHASES,
  BUILD_REQUEST_STATUSES,
  BUILD_REQUEST_TYPES,
} from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parsePersonField, parseSinglePersonField } from "./taskMapper";
import { ALL_CHECKLIST_FIELDS } from "./buildRequestChecklist";

// =============================================================================
// Build Request mappers — Graph list items → BuildRequest / BuildRequestItem.
// Mirrors eirMapper.ts / operationsTaskMapper.ts. Field-shape notes:
//   - Requestor / EngineerAssigned are SINGLE-person columns: Graph returns
//     only the bare `…LookupId` integer (no resolved object) — same limitation
//     as Operations' Assigned. We fall back to a name-less Person so the id
//     survives, and `attachBuildRequestReferences` resolves the display name
//     from the site-user directory afterward.
//   - Header ProjectReference is a MULTI-value lookup; Graph returns resolved
//     `{LookupId, LookupValue}` arrays (same as EIR's parentProjects).
//   - Item Assembly / Operations / Testing are multi-choice columns; Graph
//     returns string arrays, but we also tolerate the legacy `;#`-delimited
//     string shape defensively.
// =============================================================================

export function toBuildRequest(item: GraphListItem): BuildRequest {
  const f = item.fields as Record<string, unknown>;

  return {
    id: parseInt(item.id, 10),
    brNo: (f.BRNo_x002e_ as string) ?? "",
    title: (f.Title as string) ?? "(untitled)",
    product: (f.Product as string) ?? "",
    status: clampRequired<BuildRequestStatus>(
      f.BRStatus as string,
      BUILD_REQUEST_STATUSES,
      "Submitted",
    ),
    brType: clampOptional<BuildRequestType>(f.BrType0 as string, BUILD_REQUEST_TYPES),
    blockedReason: clampOptional<BuildRequestBlockedReason>(
      f.BlockedReason as string,
      BUILD_REQUEST_BLOCKED_REASONS,
    ),
    requiredLeadTime: clampOptional<BuildRequestLeadTime>(
      f.RequiredLeadTime as string,
      BUILD_REQUEST_LEAD_TIMES,
    ),
    quotedShipDate: parseDate(f.QuotedShipDate as string),
    samplePhase: clampOptional<BuildRequestSamplePhase>(
      f.SamplePhase as string,
      BUILD_REQUEST_SAMPLE_PHASES,
    ),
    requestor:
      parseSinglePersonField(f.Requestor) ??
      fallbackPerson(f.RequestorLookupId),
    engineerAssigned:
      parseSinglePersonField(f.EngineerAssigned) ??
      fallbackPerson(f.EngineerAssignedLookupId),
    customerName: (f.CustomerName as string) ?? "",
    customerPO: (f.CustomerPurchaseOrder as string) ?? "",
    leadFree: !!f.RoHS,
    watchers: parsePersonField(f.Watchers),
    parentProjects: readMultiLookup(f, "ProjectReference"),
    taskReferenceLookupId: toIntOrNull(f.TaskReferenceLookupId),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
    author: parseCreatedByUser(item.createdBy),
    editor: parseCreatedByUser(item.lastModifiedBy),
    comments: parseCommunication(f.Communication as string),
    hasAttachments: !!f.Attachments,
    rawFields: f,
  };
}

export function toBuildRequestItem(item: GraphListItem): BuildRequestItem {
  const f = item.fields as Record<string, unknown>;

  const checklist: Record<string, boolean> = {};
  for (const def of ALL_CHECKLIST_FIELDS) {
    checklist[def.field] = !!f[def.field];
  }

  return {
    id: parseInt(item.id, 10),
    partNumber: (f.Title as string) ?? "(no part number)",
    buildRequestLookupId: toIntOrNull(f.BuildRequestNoLookupId) ?? 0,
    projectRef: readSingleLookup(f, "ProjectReference"),
    partDesc: (f.PartDesc as string) ?? "",
    drawingNo: (f.DrawingNo as string) ?? "",
    drawingRev: (f.DrawingRev as string) ?? "",
    qty: typeof f.Qty === "number" ? f.Qty : toIntOrNull(f.Qty),
    woNo: (f.WONo_x002e_ as string) ?? "",
    specialInstructions: (f.SpecialInstructions as string) ?? "",
    testPlan: (f.TestPlan as string) ?? "",
    opSummary: (f.OPSummary as string) ?? "",
    serialNos: (f.SerialNos as string) ?? "",
    revisionDate: (f.RevisionDate as string) ?? "",
    partType: clampOptional<BuildRequestPartType>(
      f.PartType as string,
      BUILD_REQUEST_PART_TYPES,
    ),
    partStatus: clampOptional<BuildRequestPartStatus>(
      f.Part_x0020_Status as string,
      BUILD_REQUEST_PART_STATUSES,
    ),
    disposition: clampOptional<BuildRequestDisposition>(
      f.Disposition as string,
      BUILD_REQUEST_DISPOSITIONS,
    ),
    assembly: parseMultiChoice(f.Assembly),
    operations: parseMultiChoice(f.Operations),
    testing: parseMultiChoice(f.Testing),
    checklist,
    taskRefLookupId: toIntOrNull(f.Task_x0020_RefLookupId),
    watchers: parsePersonField(f.Watchers),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
    author: parseCreatedByUser(item.createdBy),
    editor: parseCreatedByUser(item.lastModifiedBy),
    comments: parseCommunication(f.Communication as string),
    hasAttachments: !!f.Attachments,
    rawFields: f,
  };
}

/**
 * Resolve project titles + requestor/engineer display names by joining
 * against the projects catalogue and the site-user directory. Mutates in
 * place; mirrors attachEirReferences in eirMapper.ts.
 */
export function attachBuildRequestReferences(
  brs: BuildRequest[],
  projects: ProjectReference[],
  usersById: Map<number, Person>,
): BuildRequest[] {
  const byProjectId = new Map(projects.map((p) => [p.lookupId, p.title]));

  const resolvePerson = (p: Person | null): Person | null => {
    if (!p || p.displayName || !p.lookupId) return p;
    return usersById.get(p.lookupId) ?? p;
  };

  for (const br of brs) {
    br.parentProjects = br.parentProjects.map((p) => {
      if (p.lookupId > 0 && !p.title) {
        const title = byProjectId.get(p.lookupId);
        if (title) return { ...p, title };
      }
      return p;
    });
    br.requestor = resolvePerson(br.requestor);
    br.engineerAssigned = resolvePerson(br.engineerAssigned);
  }
  return brs;
}

// ---- helpers ---------------------------------------------------------------

function clampRequired<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

function clampOptional<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T | null {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return null;
}

function parseCreatedByUser(
  createdBy: { user?: { displayName?: string; email?: string } } | undefined,
): Person | null {
  const user = createdBy?.user;
  if (!user || !user.displayName) return null;
  return { displayName: user.displayName, email: user.email };
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIntOrNull(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Bare-LookupId fallback for single-person columns Graph didn't expand. */
function fallbackPerson(rawLookupId: unknown): Person | null {
  const id = toIntOrNull(rawLookupId);
  return id ? { lookupId: id, displayName: "" } : null;
}

/**
 * Parse a multi-choice column value. Graph returns a string array; the
 * legacy `;#value;#value;#` delimited string shape is handled defensively.
 */
export function parseMultiChoice(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  }
  if (typeof raw === "string") {
    return raw
      .split(";#")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Read a multi-value lookup as ProjectReference[]. Handles resolved
 * `{LookupId, LookupValue}` objects, bare ints, numeric strings, and both
 * the bare field name and its `…LookupId` sibling (eirMapper pattern).
 */
function readMultiLookup(f: Record<string, unknown>, fieldName: string): ProjectReference[] {
  const refs: ProjectReference[] = [];
  extractRefsInto(f[fieldName], refs);
  if (refs.length === 0) extractRefsInto(f[`${fieldName}LookupId`], refs);
  return refs;
}

/** Read a single-value lookup as one ProjectReference (or null). */
function readSingleLookup(
  f: Record<string, unknown>,
  fieldName: string,
): ProjectReference | null {
  const refs = readMultiLookup(f, fieldName);
  return refs[0] ?? null;
}

function extractRefsInto(raw: unknown, out: ProjectReference[]): void {
  if (raw == null || raw === "") return;
  if (Array.isArray(raw)) {
    for (const item of raw) extractRefsInto(item, out);
    return;
  }
  if (typeof raw === "number") {
    if (raw > 0) out.push({ lookupId: raw, title: "" });
    return;
  }
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n > 0 && String(n) === raw.trim()) {
      out.push({ lookupId: n, title: "" });
    }
    return;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    let lookupId = 0;
    for (const k of ["LookupId", "lookupId", "Id", "id"] as const) {
      const v = obj[k];
      if (typeof v === "number" && v > 0) {
        lookupId = v;
        break;
      }
      if (typeof v === "string") {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n) && n > 0) {
          lookupId = n;
          break;
        }
      }
    }
    let title = "";
    for (const k of ["LookupValue", "Title", "DisplayName"] as const) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) {
        title = v.trim();
        break;
      }
    }
    if (lookupId > 0) out.push({ lookupId, title });
  }
}
