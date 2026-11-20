import type { FeatureRequest } from "@/types/task";
import { matchesAnyEmail } from "./emailIdentity";

// =============================================================================
// ARC Feature Request → BusinessIT GitHub issue. Pure: who may do it, how an
// existing issue is recognised, and what a new one says.
//
// Tim, 2026-10-06: Ray and Tim both work the BusinessIT repo and its "Business
// IT Tasks" board, and want to turn a feature request into an issue there
// without retyping it — and to see when one already exists.
//
// **The link lives in the ISSUE, not in SharePoint.** Every issue ARC creates
// carries a hidden `<!-- arc-feature-request:<id> -->` marker plus a visible
// link back to the request, and "does it already exist" is answered by
// scanning the repo's issues for either. So there is no column to keep in step
// with GitHub, and an issue somebody created by hand that pastes the ARC link
// is recognised too.
// =============================================================================

/**
 * The only people who see the GitHub controls. HARD-CODED, like the EIR
 * Project Reference editors: they are the two people who triage the BusinessIT
 * board, and changing who is a deliberate code change.
 *
 * UI-level only, like every gate in ARC. The real boundary is GitHub itself:
 * every call is made with the person's own token, so somebody without access
 * to the private repo gets nothing however the button came to be on screen.
 */
export const FEATURE_REQUEST_ISSUE_MANAGERS = [
  "ray.white@altronic-llc.com",
  "tim.webster@altronic-llc.com",
] as const;

/** Matched through `matchesAnyEmail` — a UPN is not a mailbox (the Steve Pirko lesson). */
export function canManageFeatureRequestIssues(myEmails: string[]): boolean {
  return FEATURE_REQUEST_ISSUE_MANAGERS.some((allowed) => matchesAnyEmail(myEmails, allowed));
}

/** A BusinessIT issue, as much of it as ARC needs. */
export interface GitHubIssue {
  number: number;
  /** GraphQL node id — what the Projects (v2) API adds to a board. */
  nodeId: string;
  title: string;
  state: "open" | "closed";
  htmlUrl: string;
  body: string;
}

export interface GitHubIssueDraft {
  title: string;
  body: string;
  labels: string[];
}

const MARKER_RE = /<!--\s*arc-feature-request:(\d+)\s*-->/gi;
// `(?!\d)` so request 12 never matches a link to request 123.
const LINK_RE = /\/feature-request\/(\d+)(?!\d)/gi;

export function featureRequestMarker(id: number): string {
  return `<!-- arc-feature-request:${id} -->`;
}

/** Every feature request id an issue body points at — marker or pasted ARC link. */
export function featureRequestIdsInIssue(body: string): number[] {
  const ids = new Set<number>();
  for (const re of [MARKER_RE, LINK_RE]) {
    for (const match of body.matchAll(re)) ids.add(Number(match[1]));
  }
  return [...ids];
}

/**
 * The issue already tracking this request, or null. With more than one, the
 * OPEN one wins, then the newest — a closed duplicate shouldn't hide live work.
 */
export function findLinkedIssue(requestId: number, issues: GitHubIssue[]): GitHubIssue | null {
  const linked = issues.filter((i) => featureRequestIdsInIssue(i.body).includes(requestId));
  if (linked.length === 0) return null;
  return [...linked].sort((a, b) => {
    if (a.state !== b.state) return a.state === "open" ? -1 : 1;
    return b.number - a.number;
  })[0];
}

/**
 * Title comparison key: lower case, alphanumerics only, an "ARC:" prefix
 * ignored — most hand-made issues are titled "ARC: <the request>".
 */
export function issueTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\s*arc\s*[:\-–—]\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Words that say nothing about WHICH request an issue is about.
const STOP_WORDS = new Set(
  (
    "the and for with from that this when into onto add arc use can should would could " +
    "need needs want able ability make have has are was were not all any its our your " +
    "their them they then than also there what which who how new will been being " +
    "requested department priority low medium high note original"
  ).split(" "),
);

/**
 * The words that identify a piece of text: lower case, 3+ characters, stop
 * words dropped, a plural "s" folded ("filters" = "filter"). Tags stripped,
 * since an issue body can hold `<img>` markup.
 */
export function significantWords(text: string): Set<string> {
  const words = text.replace(/<[^>]+>/g, " ").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < 3 || STOP_WORDS.has(w)) continue;
    // Both sides are folded the same way, so a crude rule ("status" → "statu")
    // still compares like with like.
    out.add(w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  }
  return out;
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

function nameKey(name: string): string {
  return (name.toLowerCase().match(/[a-z]+/g) ?? []).sort().join(" ");
}

/**
 * Does the issue's "Requested by:" line name this person? The hand-made issues
 * (#1–#15) all carry one. Order-insensitive, so "Waldron, Jerrod" matches.
 */
export function issueNamesRequester(body: string, name: string | undefined): boolean {
  if (!name?.trim()) return false;
  const line = body.match(/requested by\W*([^\n]+)/i);
  return !!line && nameKey(line[1]) === nameKey(name);
}

/**
 * How likely an issue is to be about this request, 0 to 1 — or 0 when it
 * isn't a candidate at all.
 *
 * The issues raised by hand before ARC could do it have REWORDED titles
 * ("ARC: Add due date to the task-assigned email") and no link back, so an
 * exact title match found one of fifteen (Tim, 2026-10-06). Three signals,
 * any of which can carry it:
 *  - title words in common (as a share of the SHORTER title);
 *  - the request's description words found in the issue;
 *  - the issue's "Requested by" naming the requester.
 */
export function issueMatchScore(request: FeatureRequest, issue: GitHubIssue): number {
  if (issueTitleKey(issue.title) && issueTitleKey(issue.title) === issueTitleKey(request.title)) {
    return 1;
  }
  const reqTitle = significantWords(request.title);
  const issueTitle = significantWords(issue.title);
  const titleShared = sharedCount(reqTitle, issueTitle);
  const titleRatio =
    reqTitle.size && issueTitle.size ? titleShared / Math.min(reqTitle.size, issueTitle.size) : 0;

  const desc = significantWords(request.description);
  // A two-word description matching proves nothing.
  const descRatio =
    desc.size >= 4 ? sharedCount(desc, significantWords(`${issue.title} ${issue.body}`)) / desc.size : 0;

  const named = issueNamesRequester(issue.body, request.requestedBy?.displayName);

  const candidate =
    (titleShared >= 2 && titleRatio >= 0.5) ||
    (named && (titleShared >= 1 || descRatio >= 0.3)) ||
    descRatio >= 0.5;
  if (!candidate) return 0;
  return Math.min(0.99, titleRatio * 0.5 + descRatio * 0.4 + (named ? 0.25 : 0));
}

/**
 * Issues that are PROBABLY this request but don't say so — best first, at
 * most three. Never treated as linked: a person confirms with Link (which
 * writes the marker into the issue) or ignores them and creates a new one.
 * An issue already linked to ANY request is not a candidate — it's taken.
 */
export function findSimilarIssues(request: FeatureRequest, issues: GitHubIssue[]): GitHubIssue[] {
  return issues
    .filter((i) => featureRequestIdsInIssue(i.body).length === 0)
    .map((issue) => ({ issue, score: issueMatchScore(request, issue) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || b.issue.number - a.issue.number)
    .slice(0, 3)
    .map((m) => m.issue);
}

/** The link to a request's page in the LIVE app, for storing in an issue. */
export function featureRequestProductionUrl(id: number, base: string): string {
  return `${base.replace(/\/$/, "")}/feature-request/${id}`;
}

/** What Link appends to an existing issue so the scan recognises it exactly. */
export function linkedIssueFooter(requestId: number, arcUrl: string): string {
  return `\n\n---\n_Linked to [ARC Feature Request #${requestId}](${arcUrl})._\n${featureRequestMarker(requestId)}`;
}

/**
 * The labels this request WANTS, in the repo's own spelling. `labelsFor…`
 * then keeps only those the repo actually has — a missing department label
 * (there is no "dept: Panels" yet) is dropped, not invented.
 */
export function wantedLabels(request: FeatureRequest): string[] {
  const labels = ["ARC", "enhancement"];
  if (request.department) labels.push(`dept: ${request.department}`);
  if (request.priority) labels.push(`priority: ${request.priority.toLowerCase()}`);
  return labels;
}

export function labelsForFeatureRequest(request: FeatureRequest, repoLabels: string[]): string[] {
  const byLower = new Map(repoLabels.map((l) => [l.toLowerCase(), l]));
  return wantedLabels(request)
    .map((l) => byLower.get(l.toLowerCase()))
    .filter((l): l is string => !!l);
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ") || "—";
}

/** The issue ARC opens for a request. `arcUrl` is the request's page in ARC. */
export function buildIssueFromFeatureRequest(
  request: FeatureRequest,
  arcUrl: string,
  repoLabels: string[],
): GitHubIssueDraft {
  const description = request.description.trim() || "_No description was given._";
  const body = [
    `**From ARC Feature Request #${request.id}:** ${arcUrl}`,
    "",
    description,
    "",
    "| | |",
    "|---|---|",
    `| Department | ${cell(request.department ?? "")} |`,
    `| Priority | ${cell(request.priority ?? "")} |`,
    `| Requested by | ${cell(request.requestedBy?.displayName ?? "")} |`,
    `| Status in ARC | ${cell(request.status)} |`,
    "",
    featureRequestMarker(request.id),
  ].join("\n");
  const title = request.title.trim() || `Feature Request #${request.id}`;
  return {
    // Every ARC issue on the board reads "ARC: …" (Tim, 2026-10-06) — the
    // repo holds other Business IT work too. Not doubled if it's already there.
    title: /^\s*arc\b/i.test(title) ? title : `ARC: ${title}`,
    body,
    labels: labelsForFeatureRequest(request, repoLabels),
  };
}
