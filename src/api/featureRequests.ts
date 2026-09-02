import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_FEATURE_REQUESTS_LIST_ID, USE_MOCK } from "./config";
import { listSiteUserDirectory } from "./siteUsers";
import { resolveCurrentUserLookupId } from "./currentUser";
import type { FeatureRequest, FeatureRequestInput, GraphListItem, Person } from "@/types/task";
import {
  FEATURE_REQUEST_SELECT,
  attachFeatureRequestPeople,
  compareFeatureRequests,
  toFeatureRequest,
} from "@/lib/featureRequestMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { autoWatchers } from "@/lib/people";
import { MOCK_FEATURE_REQUESTS } from "@/data/featureRequestMockData";

// =============================================================================
// ARC Feature Requests — Engineering site (SITES.engineering).
//
// A place for any signed-in user to request a new ARC feature or change,
// separate from "Report issue" (which is for something BROKEN). No admin
// gate anywhere — creating, commenting and changing status/priority/target
// version are open to any signed-in user, by design (see CLAUDE.md).
//
// `RequestedBy` is a SINGLE-value person column, auto-filled to the
// submitter on create and never hand-picked. Graph hands it back as a bare
// `RequestedByLookupId` even when the friendly name is selected — the same
// trap FAIT and Panel Orders hit — so it's resolved after the fact against
// the Engineering site's user directory (`listSiteUserDirectory` +
// `attachFeatureRequestPeople`).
//
// `Communication` is a PLAIN text column here (not SharePoint Enhanced rich
// text like the EIR long-text fields) — the ordinary pipe-delimited comment
// format every other list uses, via communicationParser.ts.
// =============================================================================

let mockStore: FeatureRequest[] = MOCK_FEATURE_REQUESTS.map((r) => ({ ...r }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_FEATURE_REQUESTS_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_FEATURE_REQUESTS_LIST_ID is not set.`);
  }
  return SP_FEATURE_REQUESTS_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.engineering}/lists/${requireListId("reach the feature request")}/items/${id}`;
}

/**
 * Every feature request, open-first then newest-first — see
 * compareFeatureRequests.
 *
 * Returns an empty list — never throws — when the list id isn't configured
 * yet, mirroring Quick Links: the screen reports itself as "not configured"
 * rather than erroring, since the real list doesn't exist in SharePoint
 * until Ray runs the setup script.
 */
export async function listFeatureRequests(): Promise<FeatureRequest[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareFeatureRequests).map((r) => ({ ...r })));
  }
  if (!SP_FEATURE_REQUESTS_LIST_ID) return [];

  const [items, siteUsers] = await Promise.all([
    graphFetchAll<GraphListItem>(
      `/sites/${SITES.engineering}/lists/${SP_FEATURE_REQUESTS_LIST_ID}/items` +
        `?$expand=fields($select=${FEATURE_REQUEST_SELECT})&$top=999`,
    ),
    listSiteUserDirectory(SITES.engineering),
  ]);
  const requests = items.map(toFeatureRequest);
  attachFeatureRequestPeople(requests, siteUsers);
  return requests.sort(compareFeatureRequests);
}

export async function getFeatureRequest(id: number): Promise<FeatureRequest | null> {
  if (USE_MOCK) {
    const found = mockStore.find((r) => r.id === id);
    return delay(found ? { ...found } : null);
  }
  if (!SP_FEATURE_REQUESTS_LIST_ID) return null;

  try {
    const [item, siteUsers] = await Promise.all([
      graphFetch<GraphListItem>(
        `${itemPath(id)}?$expand=fields($select=${FEATURE_REQUEST_SELECT})`,
      ),
      listSiteUserDirectory(SITES.engineering),
    ]);
    const request = toFeatureRequest(item);
    attachFeatureRequestPeople([request], siteUsers);
    return request;
  } catch {
    return null;
  }
}

/** Create a new request. RequestedBy is auto-resolved to the current user; Status defaults to Pending Review. */
export async function createFeatureRequest(
  input: FeatureRequestInput,
  requester: Person,
): Promise<FeatureRequest> {
  const watchers = autoWatchers(undefined, undefined, requester);

  if (USE_MOCK) {
    const now = new Date();
    const request: FeatureRequest = {
      id: Math.max(0, ...mockStore.map((r) => r.id)) + 1,
      title: input.title.trim(),
      description: input.description.trim(),
      department: input.department,
      requestedBy: requester,
      priority: input.priority,
      status: "Pending Review",
      targetVersion: "",
      comments: [],
      watchers,
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
      author: requester,
    };
    mockStore = [request, ...mockStore];
    return delay({ ...request });
  }

  const listId = requireListId("create the feature request");
  const requestedByLookupId = requester.email
    ? requester.lookupId || (await resolveCurrentUserLookupId(requester.email))
    : 0;

  const fields: Record<string, unknown> = {
    Title: input.title.trim(),
    Description: input.description.trim(),
    Status: "Pending Review",
    ...multiPersonField("Watchers", watchers),
  };
  if (input.department) fields.Department = input.department;
  if (input.priority) fields.Priority = input.priority;
  if (requestedByLookupId) fields.RequestedByLookupId = requestedByLookupId;

  const created = await graphFetch<GraphListItem>(`/sites/${SITES.engineering}/lists/${listId}/items`, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return (await getFeatureRequest(parseInt(created.id, 10))) ?? toFeatureRequest(created);
}

/** Generic field patch — status, priority, target version, and comments. */
export async function updateFeatureRequestFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<FeatureRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`Feature request ${id} not found`);
    const next = { ...mockStore[idx] };
    if ("Title" in fields) next.title = (fields.Title as string) ?? "";
    if ("Description" in fields) next.description = (fields.Description as string) ?? "";
    if ("Department" in fields) {
      next.department = (fields.Department as FeatureRequest["department"]) ?? null;
    }
    if ("Priority" in fields) {
      next.priority = (fields.Priority as FeatureRequest["priority"]) ?? null;
    }
    if ("Status" in fields) next.status = fields.Status as FeatureRequest["status"];
    if ("TargetVersion" in fields) next.targetVersion = (fields.TargetVersion as string) ?? "";
    if ("Communication" in fields) {
      // Comment writes go through addFeatureRequestComment / editFeatureRequestComment
      // in mock mode too, but tolerate a direct field write for symmetry with real mode.
    }
    if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
      next.watchers = fields.Watchers as Person[];
    }
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const reloaded = await getFeatureRequest(id);
  if (!reloaded) throw new Error(`Feature request ${id} disappeared after update`);
  return reloaded;
}

/** Replace the Watchers list. */
export async function setFeatureRequestWatchers(
  id: number,
  people: Person[],
): Promise<FeatureRequest> {
  if (USE_MOCK) {
    return updateFeatureRequestFields(id, { Watchers: people });
  }
  return updateFeatureRequestFields(id, multiPersonField("Watchers", people));
}

/** Append a comment to a feature request's Communication field. */
export async function addFeatureRequestComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<FeatureRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`Feature request ${id} not found`);
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
    return delay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = appendComment(existingRaw, comment);
  return updateFeatureRequestFields(id, { Communication: newRaw });
}

/** Edit the body of an existing comment, matched by timestamp + author email. */
export async function editFeatureRequestComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<FeatureRequest> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`Feature request ${id} not found`);
    const next = { ...mockStore[idx] };
    const targetEmail = target.authorEmail.toLowerCase();
    next.comments = next.comments.map((c) =>
      c.timestamp.getTime() === target.timestamp.getTime() &&
      c.authorEmail.toLowerCase() === targetEmail
        ? { ...c, bodyHtml: newBodyHtml }
        : c,
    );
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = replaceComment(existingRaw, target, newBodyHtml);
  return updateFeatureRequestFields(id, { Communication: newRaw });
}

/** Resolve a mentioned email to an Engineering-site lookupId — for autoWatchFromMentions. */
export async function resolveFeatureRequestSiteUserLookupId(email: string): Promise<number> {
  return resolveCurrentUserLookupId(email);
}

/** Flatten every Person across the feature request list, deduped by email/displayName. */
export function collectFeatureRequestPeople(requests: FeatureRequest[]): Person[] {
  const map = new Map<string, Person>();
  for (const r of requests) {
    const people = r.requestedBy ? [r.requestedBy, ...r.watchers] : r.watchers;
    for (const p of people) {
      const key = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(key) && p.lookupId) map.set(key, p);
    }
  }
  return [...map.values()];
}
