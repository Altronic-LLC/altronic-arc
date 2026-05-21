import type {
  Eir,
  EirItemFields,
  EirMeetingRelevant,
  EirRequestedPriority,
  EirRequestType,
  EirResolution,
  EirRiskLevel,
  EirRiskPart,
  EirStatus,
  GraphListItem,
  Person,
  ProjectReference,
} from "@/types/task";
import {
  EIR_MEETING_RELEVANTS,
  EIR_REQUEST_TYPES,
  EIR_REQUESTED_PRIORITIES,
  EIR_RESOLUTIONS,
  EIR_RISK_LEVELS,
  EIR_RISK_PARTS,
  EIR_STATUSES,
} from "@/types/task";
import { parseCommunication } from "./communicationParser";

/**
 * Graph list item → Eir. Mirrors src/lib/taskMapper.ts in shape — boundary
 * between the SharePoint wire format and the typed domain. Internal column
 * names are quirky (escaped slashes, x0020 spaces, truncated long names)
 * so this file is the place to absorb that ugliness.
 */
export function toEir(item: GraphListItem): Eir {
  const f = (item.fields ?? {}) as unknown as EirItemFields;

  return {
    id: parseInt(item.id, 10),
    eirNo: (f.EIRNo as string) ?? "",
    title: (f.Title as string) ?? "(untitled EIR)",
    description: (f.Description as string) ?? "",
    requestType: clampOptional<EirRequestType>(f.RequestType, EIR_REQUEST_TYPES),
    status: clampRequired<EirStatus>(f.Status, EIR_STATUSES, "Under Review"),
    resolution: clampRequired<EirResolution>(f.Resolution, EIR_RESOLUTIONS, "Pending"),
    requestedPriority: clampOptional<EirRequestedPriority>(
      f.Priority,
      EIR_REQUESTED_PRIORITIES,
    ),

    // Reporter is a single-person column on the EIR list. Graph may
    // return it as an expanded `{ LookupId, LookupValue, Email }` object
    // under `Reporter`, or — depending on how the $select interacts with
    // the column type — only as the bare `ReporterLookupId` integer.
    // parsePersonSingle handles both shapes (object via Reporter, integer
    // via ReporterLookupId fallback) so we get a Person either way.
    reporter:
      parsePersonSingle(f.Reporter) ?? parsePersonSingle(f.ReporterLookupId),
    assignedEngineers: parsePersonMulti(f.AssignedEngineer),
    watchers: parsePersonMulti(f.Watchers),
    parentProjects: readProjectReferences(f),
    taskReference: (f.TaskReference as string) ?? "",

    engineeringResponse: (f.EngineeringResponse as string) ?? "",

    whereUsed: (f.WhereUsed as string) ?? "",
    eau: (f.EAU as string) ?? "",
    currentStock: (f.CurrentStock as string) ?? "",
    mfg: (f.MFG as string) ?? "",
    mfgPartNumber: (f.MFGP_x002f_N as string) ?? "",
    currentPrice: (f.Current_x0020_Price as string) ?? "",
    altronicPartNumber: (f.Altronic_x0020_Part_x0020_Number as string) ?? "",

    requestedCompletionDate: parseDate(f.Requested_x0020_Completion_x0020),
    ltbDate: parseDate(f.LTBDate),
    priorityDate: parseDate(f.PriorityDate),

    priorityNumber: parseNullableNumber(f.Priority0),
    priorityCount: parseNullableNumber(f.PriorityCount),
    technicalPriority: clampOptional<EirRiskLevel>(f.TechnicalPriority, EIR_RISK_LEVELS),
    riskPart: clampOptional<EirRiskPart>(f.RiskPart, EIR_RISK_PARTS),
    riskPartLevel: clampOptional<EirRiskLevel>(f.RiskPartLevel, EIR_RISK_LEVELS),

    eirMeetingRelevant: clampOptional<EirMeetingRelevant>(
      f.EIRMeetingRelevant,
      EIR_MEETING_RELEVANTS,
    ),
    buyerCode: (f.BuyerCode as string) ?? "",
    taskPromotedFlag: !!f.TaskPromotedFlag,

    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
    author: parseCreatedByUser(item.createdBy),
    editor: parseCreatedByUser(item.lastModifiedBy),
    comments: parseCommunication(f.Communication as string),
    hasAttachments: !!f.Attachments,
  };
}

/** Resolve project + task lookup titles by joining against the supplied caches. */
export function attachEirReferences(
  eirs: Eir[],
  projects: ProjectReference[],
  siteUsers: Person[] = [],
): Eir[] {
  const byProjectId = new Map(projects.map((p) => [p.lookupId, p.title]));

  // Build a people directory keyed by SP lookupId. Three sources, in
  // descending priority:
  //   1. The SharePoint User Information List (passed in via siteUsers).
  //   2. Any EIR in this response where Graph DID return a fully-
  //      expanded Person object (Watchers / Assigned Engineers).
  //   3. (Nothing — the placeholder "User #N" stays.)
  const peopleById = new Map<number, Person>();
  for (const u of siteUsers) {
    if (u.lookupId && u.displayName && !u.displayName.startsWith("User #")) {
      peopleById.set(u.lookupId, u);
    }
  }
  const noteSeen = (p: Person | null | undefined) => {
    if (!p || !p.lookupId || p.displayName.startsWith("User #")) return;
    if (!peopleById.has(p.lookupId)) peopleById.set(p.lookupId, p);
  };
  for (const e of eirs) {
    noteSeen(e.reporter);
    for (const x of e.assignedEngineers) noteSeen(x);
    for (const x of e.watchers) noteSeen(x);
  }

  for (const e of eirs) {
    // Resolve every project reference's title from the projects catalogue
    // when the mapper didn't get a name from the expanded lookup object.
    e.parentProjects = e.parentProjects.map((p) => {
      if (p.lookupId > 0 && !p.title) {
        const title = byProjectId.get(p.lookupId);
        if (title) return { ...p, title };
      }
      return p;
    });
    if (e.reporter && e.reporter.displayName.startsWith("User #") && e.reporter.lookupId) {
      const resolved = peopleById.get(e.reporter.lookupId);
      if (resolved) {
        e.reporter = {
          ...e.reporter,
          displayName: resolved.displayName,
          email: resolved.email ?? e.reporter.email,
        };
      }
    }
  }
  return eirs;
}

// ---- helpers ---------------------------------------------------------------

/**
 * Read the EIR's Project Reference field as an array of project lookups.
 *
 * Per the EIR list's column definition, "Project Reference" is a
 * **multi-value Lookup** (same shape as Tasks' "Related Projects" /
 * `ProjectReference`). Graph returns the value under the bare field name
 * `ProjectReference` as either:
 *   - an array of `{ LookupId, LookupValue }` objects (multi-lookup, expanded)
 *   - a single such object (some single-value lookup setups)
 *   - an array of bare integers (`ProjectReferenceLookupId` if requested)
 *
 * We pull (lookupId, title) pairs out of any of those shapes. Titles will
 * be empty if the lookup wasn't expanded — `attachEirReferences` then
 * joins them against the projects catalogue.
 */
function readProjectReferences(f: Record<string, unknown>): ProjectReference[] {
  // Prefer the bare `ProjectReference` field (expanded shape), fall back
  // to `ProjectReferenceLookupId` (suffixed integer-only shape) if that's
  // what Graph returned this time.
  const candidates: unknown[] = [];
  for (const [key, raw] of Object.entries(f)) {
    if (!/project/i.test(key)) continue;
    if (!/reference/i.test(key)) continue;
    candidates.push(raw);
  }
  const refs: ProjectReference[] = [];
  for (const raw of candidates) {
    extractProjectRefsInto(raw, refs);
    if (refs.length > 0) break;
  }
  return refs;
}

function extractProjectRefsInto(raw: unknown, out: ProjectReference[]): void {
  if (raw == null || raw === "") return;
  if (Array.isArray(raw)) {
    for (const item of raw) extractProjectRefsInto(item, out);
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

function clampRequired<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }
  return fallback;
}

function clampOptional<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T | null {
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }
  return null;
}

function parseDate(raw: unknown): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toInt(raw: unknown, fallback: number): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

function parseNullableNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function parsePersonSingle(raw: unknown): Person | null {
  if (raw == null || raw === "" || raw === 0) return null;

  // Bare integer or numeric string → just the lookupId. We don't know the
  // name yet (a directory lookup would resolve it), so emit a placeholder
  // Person with the id. The detail/list components show the lookupId in
  // brackets so it's clear it's unresolved.
  if (typeof raw === "number") {
    return raw > 0 ? { displayName: `User #${raw}`, lookupId: raw } : null;
  }
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n > 0) {
      return { displayName: `User #${n}`, lookupId: n };
    }
    return null;
  }

  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (typeof entry !== "object" || entry === null) return null;
  const obj = entry as Record<string, unknown>;
  const displayName =
    (obj.LookupValue as string) ?? (obj.displayName as string) ?? (obj.title as string);
  const lookupId = toInt(obj.LookupId ?? obj.lookupId, 0);
  if (!displayName && lookupId === 0) return null;
  return {
    displayName: displayName || `User #${lookupId}`,
    email: (obj.Email as string) ?? (obj.email as string),
    lookupId,
  };
}

function parsePersonMulti(raw: unknown): Person[] {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const people: Person[] = [];
  for (const entry of items) {
    if (typeof entry !== "object" || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const displayName =
      (obj.LookupValue as string) ?? (obj.displayName as string) ?? (obj.title as string);
    if (!displayName) continue;
    people.push({
      displayName,
      email: (obj.Email as string) ?? (obj.email as string),
      lookupId: toInt(obj.LookupId ?? obj.lookupId, 0),
    });
  }
  return people;
}

function parseCreatedByUser(
  createdBy: { user?: { displayName?: string; email?: string } } | undefined,
): Person | null {
  const user = createdBy?.user;
  if (!user || !user.displayName) return null;
  return { displayName: user.displayName, email: user.email };
}
