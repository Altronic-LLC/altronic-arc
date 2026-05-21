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
    parentProject: readProjectLookupId(f),
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
    comments: parseCommunication(f.Communication as string),
    hasAttachments: !!f.Attachments,
  };
}

/** Resolve project + task lookup titles by joining against the supplied caches. */
export function attachEirReferences(
  eirs: Eir[],
  projects: ProjectReference[],
): Eir[] {
  const byId = new Map(projects.map((p) => [p.lookupId, p.title]));

  // Cross-pollinate the people directory: any EIR whose Reporter / Watcher
  // / Assigned Engineer came back with a fully-expanded name is a hint we
  // can apply to other EIRs whose same-lookupId Person came back as a
  // bare `User #N` placeholder (Graph sometimes expands a single-person
  // column on one item and not another in the same response).
  const peopleById = new Map<number, Person>();
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
    if (e.parentProject && e.parentProject.lookupId > 0) {
      const joined = byId.get(e.parentProject.lookupId);
      if (joined && !e.parentProject.title) e.parentProject.title = joined;
    }
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
 * Read the EIR's Project Reference field.
 *
 * Confirmed shape (per the SharePoint column definition on this list):
 * "Project Reference" is a **multi-select Choice column**, NOT a Lookup.
 * That means the value comes back as either:
 *   - an array of strings: `["2026-Cat Pyrometer, 133-6333"]`
 *   - a `;#`-delimited string: `";#2026-Cat Pyrometer, 133-6333;#"`
 *   - a single string: `"2026-Cat Pyrometer, 133-6333"`
 *
 * There is no lookup id to join against — the choices themselves ARE the
 * project labels. We pack the chosen value(s) into `parentProject.title`
 * (joined with ", " when multiple) and use lookupId=0 to signal "no real
 * lookup join — title is authoritative."
 */
function readProjectLookupId(
  f: Record<string, unknown>,
): { lookupId: number; title: string } | null {
  for (const [key, raw] of Object.entries(f)) {
    if (!/project/i.test(key)) continue;
    if (!/reference/i.test(key) && !key.endsWith("LookupId")) continue;
    const choices = extractChoiceValues(raw);
    if (choices.length > 0) {
      return { lookupId: 0, title: choices.join(", ") };
    }
    // If the value happens to be a real lookup id (legacy provisioning),
    // fall back to id-based join. extractLookupId is the older code path.
    const id = extractLookupId(raw);
    if (id != null) return { lookupId: id, title: "" };
  }
  return null;
}

/**
 * Pull the chosen labels out of whatever multi-select shape SharePoint
 * returned. Covers every variant we've seen:
 *
 *   - Choice multi-select         : ["choice1", "choice2"]   or  ";#a;#b;#"
 *   - Lookup multi-select         : [{LookupId, LookupValue}, ...]
 *   - Managed-metadata multi      : [{Label, TermGuid, WssId}, ...]
 *   - Single-value variants of any of the above (object or string)
 */
function extractChoiceValues(raw: unknown): string[] {
  if (raw == null || raw === "") return [];

  if (Array.isArray(raw)) {
    return raw
      .map((v) => extractSingleLabel(v))
      .filter((v): v is string => !!v);
  }

  if (typeof raw === "string") {
    if (raw.includes(";#")) {
      // ";#" delimiter from classic SP multi-choice serialisation.
      return raw
        .split(";#")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    if (/^\d+$/.test(raw.trim())) return []; // numeric → let lookup-id path handle
    return [raw.trim()];
  }

  // Single-object variant (single-value Lookup / Managed Metadata).
  const single = extractSingleLabel(raw);
  return single ? [single] : [];
}

/**
 * Reduce one element of a multi-select array (string or object) down to a
 * single display label. Returns "" if nothing usable is in the element.
 */
function extractSingleLabel(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v == null || typeof v !== "object") return "";
  const obj = v as Record<string, unknown>;
  for (const k of [
    "LookupValue",
    "Label",
    "Title",
    "DisplayName",
    "Value",
    "value",
    "name",
    "Name",
  ] as const) {
    const val = obj[k];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return "";
}

/**
 * Legacy fallback: pull an integer lookup id out of a field value when
 * the column happens to be a real Lookup (only kept for tenants that
 * provisioned EIRs differently). Multi-choice handling above runs first.
 */
function extractLookupId(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === 0 || raw === "0") return null;
  if (typeof raw === "number") return raw > 0 ? raw : null;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && String(n) === raw.trim() && n > 0) return n;
    return null;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const k of ["LookupId", "lookupId", "Id", "id", "WssId"] as const) {
      const v = obj[k];
      if (typeof v === "number" && v > 0) return v;
      if (typeof v === "string") {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n) && n > 0) return n;
      }
    }
  }
  return null;
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
