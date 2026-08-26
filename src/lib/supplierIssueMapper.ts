import type {
  GraphListItem,
  Person,
  SupplierIssue,
  SupplierIssueInput,
  SupplierIssueSeverity,
  SupplierIssueStatus,
} from "@/types/task";
import { SUPPLIER_ISSUE_SEVERITIES, SUPPLIER_ISSUE_STATUSES } from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parseSpDate } from "./spDates";
import { parsePersonField } from "./taskMapper";
import { multiPersonField } from "./graphFields";

// =============================================================================
// Graph item → SupplierIssue, and back. `BPReference` is a SINGLE lookup into
// Suppliers List, written as a bare integer — same shape as Supplier Contact.
//
// `Status` and `Severity` are UNCONFIGURED placeholder choices in the live
// list ("Choice 1"/"Choice 2"/"Choice 3") — see the note on the consts in
// types/task.ts and CLAUDE.md.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toIssueStatus(raw: unknown): SupplierIssueStatus | null {
  const v = text(raw).trim();
  return (SUPPLIER_ISSUE_STATUSES as readonly string[]).includes(v)
    ? (v as SupplierIssueStatus)
    : null;
}

function toIssueSeverity(raw: unknown): SupplierIssueSeverity | null {
  const v = text(raw).trim();
  return (SUPPLIER_ISSUE_SEVERITIES as readonly string[]).includes(v)
    ? (v as SupplierIssueSeverity)
    : null;
}

export function toSupplierIssue(item: GraphListItem): SupplierIssue {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    supplierId: f.BPReferenceLookupId ? toInt(f.BPReferenceLookupId, 0) || null : null,
    description: text(f.Description),
    status: toIssueStatus(f.Status),
    resolution: text(f.Resolution),
    severity: toIssueSeverity(f.Severity),
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
    hasAttachments: f.Attachments === true,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

export function buildSupplierIssueCreateFields(
  input: SupplierIssueInput,
  resolved: { watchers: Person[] },
): Record<string, unknown> {
  return {
    Title: input.title.trim(),
    BPReferenceLookupId: input.supplierId,
    Description: input.description.trim(),
    Status: input.status ?? null,
    Severity: input.severity ?? null,
    ...multiPersonField("Watchers", resolved.watchers),
  };
}

export function supplierIssueFieldPatch(
  changed: Partial<Pick<SupplierIssueInput, "title" | "description" | "status" | "severity">> & {
    resolution?: string;
  },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (changed.title !== undefined) fields.Title = changed.title.trim();
  if (changed.description !== undefined) fields.Description = changed.description.trim();
  if (changed.status !== undefined) fields.Status = changed.status ?? null;
  if (changed.severity !== undefined) fields.Severity = changed.severity ?? null;
  if (changed.resolution !== undefined) fields.Resolution = changed.resolution.trim();
  return fields;
}

export function supplierIssueLabel(issue: SupplierIssue): string {
  return issue.title || `Issue #${issue.id}`;
}

/** Newest first — an issue tracker is a work queue, not an address book. */
export function compareSupplierIssues(a: SupplierIssue, b: SupplierIssue): number {
  return b.createdAt.getTime() - a.createdAt.getTime();
}
