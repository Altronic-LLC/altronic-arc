import type { EcnChecklist, GraphListItem, Person } from "@/types/task";
import { parsePersonField, parseSinglePersonField } from "./taskMapper";
import { parseCommunication } from "./communicationParser";
import { parseSpDate } from "./spDates";
import { ECN_CHECKLIST_TEMPLATE_REVISION } from "./ecnChecklistTemplate";

// =============================================================================
// Graph item -> EcnChecklist.
//
// Two single-value columns, both hitting the trap documented across this repo
// (FAIT, Supplier `BPReference`, the CMMS lists, Feature Requests):
//
//   EcnRef       single LOOKUP  -> comes back as a bare `EcnRefLookupId`
//   CompletedBy  single PERSON  -> comes back as a bare `CompletedByLookupId`
//
// Graph hands a single-value column back as the bare id even when the friendly
// name is in the `$select`, so both are read from either shape. On `EcnRef`
// that matters most: reading null there means a checklist attached to no ECN,
// which is indistinguishable from one that was never linked.
// =============================================================================

function text(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/** A count column, defaulting to 0 — a blank rollup is zero, not unknown. */
function count(v: unknown): number {
  return toInt(v) ?? 0;
}

/**
 * A single-value lookup, from either shape. Returns 0 when there is genuinely
 * no link — callers treat 0 as "orphaned", never as ECN #0.
 */
function lookupId(expanded: unknown, rawLookupId: unknown): number {
  const direct = toInt(rawLookupId);
  if (direct && direct > 0) return direct;
  if (expanded && typeof expanded === "object") {
    const e = expanded as { LookupId?: unknown };
    const id = toInt(e.LookupId);
    if (id && id > 0) return id;
  }
  return 0;
}

/** A single-person column, from either shape. A bare id becomes a nameless Person. */
function personOrLookup(expanded: unknown, rawLookupId: unknown): Person | null {
  const person = parseSinglePersonField(expanded);
  if (person) return person;
  const id = toInt(rawLookupId);
  return id && id > 0 ? { displayName: "", lookupId: id } : null;
}

function clampStatus(raw: unknown): EcnChecklist["status"] {
  const s = text(raw).trim();
  if (s === "Complete" || s === "In Progress" || s === "Not Started") return s;
  return "Not Started";
}

export function toEcnChecklist(item: GraphListItem): EcnChecklist {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    ecnId: lookupId(f.EcnRef, f.EcnRefLookupId),
    title: text(f.Title).trim(),
    status: clampStatus(f.Status),
    templateRevision: text(f.TemplateRevision).trim() || ECN_CHECKLIST_TEMPLATE_REVISION,
    answersJson: text(f.Answers),
    itemsTotal: count(f.ItemsTotal),
    itemsComplete: count(f.ItemsComplete),
    itemsNa: count(f.ItemsNa),
    itemsFlagged: count(f.ItemsFlagged),
    completedBy: personOrLookup(f.CompletedBy, f.CompletedByLookupId),
    completedDate: parseSpDate(f.CompletedDate),
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
    hasAttachments: f.Attachments === true,
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/** True when the row points at no ECN — it can appear on no ECN's page. */
export function isOrphanedChecklist(checklist: EcnChecklist): boolean {
  return checklist.ecnId === 0;
}
