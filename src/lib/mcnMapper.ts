import type { GraphListItem, Person } from "@/types/task";
import {
  MCN_STATUSES,
  type Mcn,
  type McnInput,
  type McnItem,
  type McnPatch,
  type McnScopeLine,
  type McnStatus,
} from "@/types/mcn";
import { parseCommunication } from "./communicationParser";
import { parsePersonField } from "./taskMapper";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";
import { lookupRef, personOrLookup, text } from "./maintenanceShared";
import { toStoredRichText } from "./richText";
import {
  MCN_ITEM_FIELDS,
  blankMcnItems,
  parsePeopleLines,
  parseScopeLines,
  readAnswer,
  serializeScopeLines,
} from "./mcnFields";
import { compareMcnNumbers } from "./mcnNumber";

// =============================================================================
// Graph item → Mcn, and back. Three things worth knowing:
//
//  - **Originated By, Assigned Engineer and Approved By are SINGLE-person
//    columns**, so Graph hands them back as a bare `<Name>LookupId`.
//    `personOrLookup` reads either shape; api/mcns.ts fills the names in from
//    the PMO site's User Information List.
//  - **Description is Enhanced rich text** — written through
//    `toStoredRichText`, so plain text from an editor becomes real paragraphs.
//  - **Edits are DIFFED** against the row the edit started from: only the
//    columns that moved travel. A card re-saved unchanged sends nothing.
// =============================================================================

function readStatus(raw: unknown): McnStatus {
  const v = text(raw).trim();
  return (MCN_STATUSES as readonly string[]).includes(v) ? (v as McnStatus) : "Draft";
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function parseCreatedBy(item: GraphListItem): Person | null {
  const user = item.createdBy?.user;
  if (!user?.displayName && !user?.email) return null;
  return { displayName: user.displayName ?? user.email ?? "", email: user.email };
}

export function toMcn(item: GraphListItem): Mcn {
  const f = item.fields ?? {};
  const scope = parseScopeLines(f.ScopeLines);
  const items = blankMcnItems();
  for (const field of MCN_ITEM_FIELDS) {
    items[field.key] = {
      answer: readAnswer(f[field.answerColumn]),
      reference: field.referenceColumn ? text(f[field.referenceColumn]).trim() : "",
    };
  }
  return {
    id: parseInt(item.id, 10),
    mcnNumber: text(f.Title).trim(),
    date: parseSpDateOnly(f.McnDate),
    process: text(f.Process).trim(),
    priority: text(f.Priority).trim(),
    status: readStatus(f.McnStatus),
    originatedBy: personOrLookup(f.OriginatedBy, f.OriginatedByLookupId),
    assignedEngineer: personOrLookup(f.AssignedEngineer, f.AssignedEngineerLookupId),
    approvedBy: personOrLookup(f.ApprovedBy, f.ApprovedByLookupId),
    approvedAt: parseSpDate(f.ApprovedDate),
    description: text(f.Description),
    scope: scope.lines,
    scopeCorrupt: scope.corrupt,
    items,
    distribution: strings(f.Distribution),
    distributedTo: parsePeopleLines(f.DistributedTo),
    distributedAt: parseSpDate(f.DistributedAt),
    dateImplemented: parseSpDateOnly(f.DateImplemented),
    affected: text(f.AffectedCodes).trim(),
    rejectionReason: text(f.RejectionReason).trim(),
    operationsTask: lookupRef(f.OperationsTaskRef, f.OperationsTaskRefLookupId),
    legacyNote: text(f.LegacyNote).trim(),
    watchers: parsePersonField(f.Watchers),
    comments: parseCommunication(text(f.Communication)),
    hasAttachments: f.Attachments === true,
    createdBy: parseCreatedBy(item),
    createdAt: parseSpDate(item.createdDateTime) ?? parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(item.lastModifiedDateTime) ?? parseSpDate(f.Modified) ?? new Date(0),
  };
}

/** The item columns for a set of answers — references only where the line has one. */
function itemColumns(items: Record<string, McnItem>, previous?: Record<string, McnItem>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of MCN_ITEM_FIELDS) {
    const next = items[field.key];
    if (!next) continue;
    const before = previous?.[field.key];
    if (!before || before.answer !== next.answer) {
      // A blank answer clears the choice — null, never "" (not a declared choice).
      fields[field.answerColumn] = next.answer || null;
    }
    if (field.referenceColumn && (!before || before.reference.trim() !== next.reference.trim())) {
      fields[field.referenceColumn] = next.reference.trim();
    }
  }
  return fields;
}

/**
 * The create payload, minus the number and the people (the API resolves
 * lookupIds against the PMO site). Status is always Draft. Blank values are
 * left out — SharePoint would rather not hear about a column than be handed
 * an empty value for it.
 */
export function buildMcnCreateFields(input: McnInput): Record<string, unknown> {
  const fields: Record<string, unknown> = { McnStatus: "Draft" };
  if (input.date) fields.McnDate = toSpDateOnly(input.date);
  if (input.process.trim()) fields.Process = input.process.trim();
  if (input.priority.trim()) fields.Priority = input.priority.trim();
  if (input.description.trim()) fields.Description = toStoredRichText(input.description);
  const scope = serializeScopeLines(input.scope);
  if (scope) fields.ScopeLines = scope;
  if (input.distribution.length) fields.Distribution = [...input.distribution];
  return fields;
}

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The update payload — ONLY what changed against the row the edit started
 * from. Throws rather than writing over a scope ARC couldn't read.
 */
export function buildMcnUpdateFields(changes: McnPatch, previous: Mcn): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if ("date" in changes && !sameDate(changes.date, previous.date)) {
    fields.McnDate = toSpDateOnly(changes.date ?? null);
  }
  if (changes.process !== undefined && changes.process.trim() !== previous.process) {
    fields.Process = changes.process.trim();
  }
  if (changes.priority !== undefined && changes.priority.trim() !== previous.priority) {
    fields.Priority = changes.priority.trim() || null;
  }
  if (changes.description !== undefined && changes.description !== previous.description) {
    fields.Description = changes.description.trim() ? toStoredRichText(changes.description) : "";
  }
  if (changes.scope !== undefined) {
    if (previous.scopeCorrupt) {
      throw new Error(
        `${previous.mcnNumber || "This MCN"}'s scope couldn't be read, so ARC won't write over it. ` +
          `Ask an admin to check the Scope column in SharePoint.`,
      );
    }
    const next = serializeScopeLines(changes.scope);
    if (next !== serializeScopeLines(previous.scope)) fields.ScopeLines = next;
  }
  if (changes.items !== undefined) Object.assign(fields, itemColumns(changes.items, previous.items));
  if (changes.distribution !== undefined && !sameStrings(changes.distribution, previous.distribution)) {
    fields.Distribution = [...changes.distribution];
  }
  if ("dateImplemented" in changes && !sameDate(changes.dateImplemented, previous.dateImplemented)) {
    fields.DateImplemented = toSpDateOnly(changes.dateImplemented ?? null);
  }
  if (changes.affected !== undefined && changes.affected.trim() !== previous.affected) {
    fields.AffectedCodes = changes.affected.trim();
  }
  return fields;
}

/** The row as it will read once a patch lands — for the optimistic cache and the mock store. */
export function applyMcnPatch(mcn: Mcn, changes: McnPatch): Mcn {
  const next: Mcn = { ...mcn, items: { ...mcn.items } };
  if ("date" in changes) next.date = changes.date ?? null;
  if (changes.process !== undefined) next.process = changes.process.trim();
  if (changes.priority !== undefined) next.priority = changes.priority.trim();
  if (changes.description !== undefined) {
    next.description = changes.description.trim() ? toStoredRichText(changes.description) : "";
  }
  if (changes.scope !== undefined) {
    next.scope = parseScopeLines(serializeScopeLines(changes.scope)).lines;
  }
  if (changes.items !== undefined) {
    for (const [key, item] of Object.entries(changes.items)) {
      next.items[key] = { answer: item.answer, reference: item.reference.trim() };
    }
  }
  if (changes.distribution !== undefined) next.distribution = [...changes.distribution];
  if ("dateImplemented" in changes) next.dateImplemented = changes.dateImplemented ?? null;
  if (changes.affected !== undefined) next.affected = changes.affected.trim();
  return next;
}

/** Newest MCN first; ties (and unnumbered rows) on id. */
export function compareMcns(a: Mcn, b: Mcn): number {
  return compareMcnNumbers(a.mcnNumber, b.mcnNumber) || b.id - a.id;
}

/** What to call an MCN in a toast, an email subject or a page title. */
export function mcnLabel(mcn: Pick<Mcn, "id" | "mcnNumber" | "process">): string {
  const number = mcn.mcnNumber || `MCN #${mcn.id}`;
  return mcn.process ? `${number} — ${mcn.process}` : number;
}

/** A scope line's department, shown by its CURRENT title when the list still has it. */
export function scopeDepartmentLabel(line: McnScopeLine, departments: Map<number, string>): string {
  if (line.departmentId) {
    const current = departments.get(line.departmentId);
    if (current) return current;
  }
  return line.department || (line.departmentId ? `Department #${line.departmentId}` : "");
}
