import type {
  FeatureRequest,
  FeatureRequestDepartment,
  FeatureRequestPriority,
  FeatureRequestStatus,
  GraphListItem,
  Person,
} from "@/types/task";
import {
  FEATURE_REQUEST_DEPARTMENTS,
  FEATURE_REQUEST_PRIORITIES,
  FEATURE_REQUEST_STATUSES,
} from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parsePersonField, parseSinglePersonField } from "./taskMapper";

// =============================================================================
// ARC Feature Requests mapper — Graph item → FeatureRequest, and back.
//
// RequestedBy is a SINGLE-value person column, so it hits the trap CLAUDE.md
// documents repeatedly: Graph hands back only a bare `RequestedByLookupId`
// integer even when the friendly name is in the $select. `personOrLookup`
// keeps a bare id as a nameless Person, and `attachFeatureRequestPeople`
// (called by the API module once per list load) fills the name in from the
// Engineering site's user directory — the same two-step FAIT and Panel
// Orders needed for their own single-person columns.
// =============================================================================

export const FEATURE_REQUEST_SELECT = [
  "Title",
  "Description",
  "Department",
  "RequestedByLookupId",
  "RequestedBy",
  "Priority",
  "Status",
  "TargetVersion",
  "Communication",
  "Watchers",
  "Attachments",
].join(",");

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clampDepartment(raw: unknown): FeatureRequestDepartment | null {
  const s = text(raw).trim();
  return (FEATURE_REQUEST_DEPARTMENTS as readonly string[]).includes(s)
    ? (s as FeatureRequestDepartment)
    : null;
}

function clampPriority(raw: unknown): FeatureRequestPriority | null {
  const s = text(raw).trim();
  return (FEATURE_REQUEST_PRIORITIES as readonly string[]).includes(s)
    ? (s as FeatureRequestPriority)
    : null;
}

function clampStatus(raw: unknown): FeatureRequestStatus {
  const s = text(raw).trim();
  return (FEATURE_REQUEST_STATUSES as readonly string[]).includes(s)
    ? (s as FeatureRequestStatus)
    : "Pending Review";
}

/**
 * A single-person column, from either shape Graph might hand back — same
 * pattern as `personOrLookup` in faitMapper.ts. A bare lookupId becomes a
 * nameless Person that `attachFeatureRequestPeople` fills in afterward.
 */
function personOrLookup(expanded: unknown, rawLookupId: unknown): Person | null {
  const person = parseSinglePersonField(expanded);
  if (person) return person;
  if (rawLookupId === null || rawLookupId === undefined || rawLookupId === "") return null;
  const id = typeof rawLookupId === "number" ? rawLookupId : parseInt(String(rawLookupId), 10);
  return Number.isFinite(id) && id > 0 ? { displayName: "", lookupId: id } : null;
}

function parseIdentity(
  identity: { user?: { displayName?: string; email?: string } } | undefined,
): Person | null {
  const user = identity?.user;
  if (!user || !user.displayName) return null;
  return { displayName: user.displayName, email: user.email };
}

export function toFeatureRequest(item: GraphListItem): FeatureRequest {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    description: text(f.Description),
    department: clampDepartment(f.Department),
    requestedBy: personOrLookup(f.RequestedBy, f.RequestedByLookupId),
    priority: clampPriority(f.Priority),
    status: clampStatus(f.Status),
    targetVersion: text(f.TargetVersion).trim(),
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
    hasAttachments: f.Attachments === true,
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
    author: parseIdentity(item.createdBy),
  };
}

/**
 * Resolve `requestedBy`'s display name against the Engineering site's user
 * directory (the "join after the fact" pattern) — mutates in place, mirrors
 * `attachFaitPeople`.
 */
export function attachFeatureRequestPeople(
  requests: FeatureRequest[],
  usersById: Map<number, Person>,
): void {
  for (const r of requests) {
    if (r.requestedBy && !r.requestedBy.displayName && r.requestedBy.lookupId) {
      const resolved = usersById.get(r.requestedBy.lookupId);
      if (resolved) r.requestedBy = resolved;
    }
  }
}

/**
 * Sort: open requests (Pending Review, In Work) before closed ones
 * (Completed, Not Implementing), newest first within each group.
 */
export function compareFeatureRequests(a: FeatureRequest, b: FeatureRequest): number {
  const aOpen = isOpenFeatureRequest(a) ? 0 : 1;
  const bOpen = isOpenFeatureRequest(b) ? 0 : 1;
  if (aOpen !== bOpen) return aOpen - bOpen;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

export function isOpenFeatureRequest(request: FeatureRequest): boolean {
  return request.status === "Pending Review" || request.status === "In Work";
}

/** A short label for a request — Title, falling back to a numbered placeholder. */
export function featureRequestLabel(request: FeatureRequest): string {
  return request.title.trim() || `Feature Request #${request.id}`;
}
