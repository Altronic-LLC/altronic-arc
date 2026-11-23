import type { BuildRequest, Comment, Eir, Fait, GrayMarketRequest, Task } from "@/types/task";
import { escapeHtml } from "./mentions";
import { serializeComments } from "./communicationParser";
import { eirNumbersIn, linkedTaskForEir } from "./eirTaskReference";
import { faitLabel } from "./faitMapper";
import { grayMarketLabel } from "./grayMarketMapper";

// =============================================================================
// Raising a Build Request FROM an EIR, a Gray Market request or a FAIT
// (BusinessIT#68, #69, #65). Pure: the prefill, the carried discussion and the
// derived links, with no Graph and no React.
//
// The same shape as raising one from a task (lib/buildRequestFromTask.ts), with
// three of Tim's decisions (2026-11-23) on top:
//
//  - **The #58 task rule still holds.** A build request names a task. The
//    source's linked task is PRE-PICKED when there is exactly one — an EIR's
//    promoted task, or the task of the EIR a GMR / FAIT names — otherwise the
//    usual picker / "Create a task for this" with the project pre-picked.
//  - **The discussion is copied ONCE**, at creation, oldest-first with each
//    comment's original author and time. No live mirror.
//  - **The source's part becomes the request's first part.**
//
// **The link is stored ONCE, on the Build Request** — `EIRReference` and
// `FAITReference` (single lookups, same site) and `GrayMarketRequestId` (a
// NUMBER: the Gray Market list is on the PMO site collection, which a lookup
// can't reach). The source's side is DERIVED, the TaskReference arrangement.
// =============================================================================

export type BuildRequestSourceKind = "eir" | "grayMarket" | "fait";

/** The part a source describes, to become the new request's first part. */
export interface BuildRequestSourcePart {
  partNumber: string;
  partDesc: string;
  drawingNo: string;
  qty: number | null;
}

/** Everything the form needs to raise a build request from one record. */
export interface BuildRequestSource {
  kind: BuildRequestSourceKind;
  id: number;
  /** How the record is named: EIR_2026-0123, GMR_2026-207, a FAIT's part. */
  label: string;
  /** Prefill for the request's "Product or Project Name". */
  title: string;
  projectLookupIds: number[];
  /** The task to pre-pick, when exactly one is linked. Never guessed. */
  taskId: number | null;
  /** Copied into the new request, once. */
  comments: Comment[];
  /** Null when the record names no part number. */
  part: BuildRequestSourcePart | null;
}

/** What each kind is called in a sentence. */
export const SOURCE_NOUN: Record<BuildRequestSourceKind, string> = {
  eir: "EIR",
  grayMarket: "Gray Market request",
  fait: "FAIT",
};

/** Where each kind's page lives, for links from a build request. */
export function sourcePath(kind: BuildRequestSourceKind, id: number): string {
  if (kind === "eir") return `/eir/${id}`;
  if (kind === "grayMarket") return `/supply-chain/gray-market-request/${id}`;
  return `/supply-chain/fait/${id}`;
}

function part(
  partNumber: string | undefined,
  partDesc: string | undefined,
  drawingNo = "",
  qty: number | null = null,
): BuildRequestSourcePart | null {
  const number = (partNumber ?? "").trim();
  if (!number) return null;
  return { partNumber: number, partDesc: (partDesc ?? "").trim(), drawingNo: drawingNo.trim(), qty };
}

/**
 * A quantity typed into a TEXT column ("25", "25 pcs", " 10 "). The leading
 * whole number, or null — never 0 for something unreadable, since a part with
 * quantity 0 reads as a decision somebody made.
 */
export function parseQuantity(raw: string | undefined | null): number | null {
  const m = /^\s*(\d+)/.exec(raw ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

/**
 * The EIR a free-text "EIR No." names — only when it names exactly one EIR
 * number and exactly one EIR carries it. A guess would carry the wrong
 * project and pre-pick the wrong task.
 */
export function eirNamedIn(text: string | undefined, eirs: readonly Eir[]): Eir | null {
  const numbers = eirNumbersIn(text ?? "");
  if (numbers.length !== 1) return null;
  const wanted = numbers[0].toUpperCase();
  const matches = eirs.filter((e) => e.eirNo.trim().toUpperCase() === wanted);
  return matches.length === 1 ? matches[0] : null;
}

function eirById(id: number | null, eirs: readonly Eir[]): Eir | null {
  return id == null ? null : (eirs.find((e) => e.id === id) ?? null);
}

function taskOf(eir: Eir | null, tasks: readonly Task[], eirs: readonly Eir[]): number | null {
  return eir ? (linkedTaskForEir(eir, tasks, eirs)?.id ?? null) : null;
}

export function sourceFromEir(eir: Eir, tasks: readonly Task[], eirs: readonly Eir[]): BuildRequestSource {
  return {
    kind: "eir",
    id: eir.id,
    label: eir.eirNo || `EIR #${eir.id}`,
    title: eir.title,
    projectLookupIds: eir.parentProjects.map((p) => p.lookupId),
    taskId: taskOf(eir, tasks, eirs),
    comments: eir.comments,
    // The Altronic number is what a build request's parts are listed by; the
    // manufacturer's number stands in when the EIR has none.
    part: part(eir.altronicPartNumber || eir.mfgPartNumber, eir.title),
  };
}

export function sourceFromGrayMarket(
  gmr: GrayMarketRequest,
  tasks: readonly Task[],
  eirs: readonly Eir[],
): BuildRequestSource {
  const v = gmr.values;
  // The Gray Market list has no project column, so the project — and the task
  // — come from the EIR it names, when it names exactly one.
  const eir = eirNamedIn(v.eirNo, eirs);
  return {
    kind: "grayMarket",
    id: gmr.id,
    label: grayMarketLabel(gmr),
    title: v.partDescription?.trim() || gmr.title,
    projectLookupIds: eir ? eir.parentProjects.map((p) => p.lookupId) : [],
    taskId: taskOf(eir, tasks, eirs),
    comments: gmr.comments,
    // AI Part No. is the Altronic number; Title is the SAP P/N.
    part: part(v.aiPartNo || gmr.title, v.partDescription, "", parseQuantity(v.qtyForBuildRequest)),
  };
}

export function sourceFromFait(fait: Fait, tasks: readonly Task[], eirs: readonly Eir[]): BuildRequestSource {
  const v = fait.values;
  const eir = eirById(fait.eirLookupId, eirs);
  return {
    kind: "fait",
    id: fait.id,
    label: faitLabel(fait),
    title: v.description?.trim() || v.sapPartNumber?.trim() || fait.title || `FAIT #${fait.id}`,
    projectLookupIds: fait.parentProject
      ? [fait.parentProject.lookupId]
      : eir
        ? eir.parentProjects.map((p) => p.lookupId)
        : [],
    taskId: taskOf(eir, tasks, eirs),
    comments: fait.comments,
    part: part(v.sapPartNumber, v.description, v.drawingNumber ?? ""),
  };
}

/**
 * The `Communication` value for a build request raised from a source: a note
 * saying where it came from, then the source's discussion OLDEST-first (the
 * stored order), each comment keeping its original author and time.
 */
export function buildSourceCommunication(args: {
  source: BuildRequestSource;
  raisedBy: { displayName: string; email?: string };
  now: Date;
}): string {
  const { source, raisedBy, now } = args;
  const header = {
    timestamp: now,
    authorName: raisedBy.displayName || "ARC",
    authorEmail: raisedBy.email ?? "",
    bodyHtml: `<p><em>Raised from ${SOURCE_NOUN[source.kind]} <strong>${escapeHtml(source.label)}</strong>.${
      source.comments.length > 0 ? " Original discussion carried over below." : ""
    }</em></p>`,
  };
  const carried = [...source.comments]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((c) => ({
      timestamp: c.timestamp,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      bodyHtml: c.bodyHtml,
    }));
  return serializeComments([header, ...carried]);
}

/** The create-input fields that store the link, for one source. */
export function sourceLinkInput(source: BuildRequestSource): {
  eirReferenceLookupId?: number;
  grayMarketRequestId?: number;
  faitReferenceLookupId?: number;
} {
  if (source.kind === "eir") return { eirReferenceLookupId: source.id };
  if (source.kind === "grayMarket") return { grayMarketRequestId: source.id };
  return { faitReferenceLookupId: source.id };
}

/**
 * The SharePoint column that stores a link of this kind, and the value that
 * sets it (an id) or clears it (null). Single lookups and the number column
 * alike take a bare integer.
 */
export function sourceLinkFields(
  kind: BuildRequestSourceKind,
  id: number | null,
): Record<string, number | null> {
  if (kind === "eir") return { EIRReferenceLookupId: id };
  if (kind === "grayMarket") return { GrayMarketRequestId: id };
  return { FAITReferenceLookupId: id };
}

/** A build request with the link of this kind set to `id` (or cleared). */
export function withSourceLink(
  br: BuildRequest,
  kind: BuildRequestSourceKind,
  id: number | null,
): BuildRequest {
  if (kind === "eir") return { ...br, eirReferenceLookupId: id };
  if (kind === "grayMarket") return { ...br, grayMarketRequestId: id };
  return { ...br, faitReferenceLookupId: id };
}

/**
 * The build requests offered by "Link existing" on a record: every request
 * NOT already linked to this record, open ones first, newest first within
 * each. A request linked to ANOTHER record of the same kind is still offered
 * — a request holds one link per kind, so linking it MOVES it, and the
 * caller says so before writing (`linkedElsewhere`).
 */
export function linkableBuildRequests(
  buildRequests: readonly BuildRequest[],
  kind: BuildRequestSourceKind,
  id: number,
): BuildRequest[] {
  const done = (br: BuildRequest) => (br.status === "Complete" ? 1 : 0);
  return buildRequests
    .filter((br) => sourceIdOf(br, kind) !== id)
    .sort((a, b) => done(a) - done(b) || b.id - a.id);
}

/** The OTHER record of this kind a request is already linked to, if any. */
export function linkedElsewhere(
  br: BuildRequest,
  kind: BuildRequestSourceKind,
  id: number,
): number | null {
  const current = sourceIdOf(br, kind);
  return current != null && current !== id ? current : null;
}

/** The source a build request names, read off the request. */
export function sourceIdOf(br: BuildRequest, kind: BuildRequestSourceKind): number | null {
  if (kind === "eir") return br.eirReferenceLookupId ?? null;
  if (kind === "grayMarket") return br.grayMarketRequestId ?? null;
  return br.faitReferenceLookupId ?? null;
}

/** Did the create actually store the link? (False when the columns are missing.) */
export function sourceLinkSaved(br: BuildRequest, source: BuildRequestSource): boolean {
  return sourceIdOf(br, source.kind) === source.id;
}

/**
 * Every build request raised from this record, newest first. Refuses a null
 * id: `null === null` would link every unlinked request to it.
 */
export function buildRequestsForSource(
  buildRequests: readonly BuildRequest[],
  kind: BuildRequestSourceKind,
  id: number | null,
): BuildRequest[] {
  if (id == null) return [];
  return buildRequests.filter((br) => sourceIdOf(br, kind) === id).sort((a, b) => b.id - a.id);
}

/**
 * What to write into a Gray Market request's own "Build Request No" text
 * column, so the number shows there in SharePoint too — or null when nothing
 * needs writing. Never replaces what somebody typed: a different number is
 * kept and the new one added after it.
 */
export function grayMarketBuildRequestNo(existing: string | undefined, brNo: string): string | null {
  const now = (existing ?? "").trim();
  const add = brNo.trim();
  if (!add) return null;
  if (!now) return add;
  const already = now.split(/[,;\s]+/).some((part) => part.toUpperCase() === add.toUpperCase());
  return already ? null : `${now}, ${add}`;
}
