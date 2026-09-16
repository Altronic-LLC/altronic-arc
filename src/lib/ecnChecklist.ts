// =============================================================================
// ECN Checklist - the stored answers, the merge, and the progress maths.
//
// Pure. No React, no Graph, no `Date.now()` beyond what a caller passes in.
//
// STORAGE SHAPE - one SharePoint row per ECN, with all 84 answers in ONE
// multi-line text column (`Answers`) as JSON. Not 84 rows per ECN: 1,800+
// ECNs x 84 items is 150,000+ list items, well past SharePoint's 5,000-item
// threshold, and 84 writes to create one checklist. One row per ECN is 1,800
// rows and one write. The trade-off, stated plainly: individual answers are
// NOT queryable from SharePoint's own views - which is why the rollup columns
// (`ItemsComplete` / `ItemsNa` / `ItemsFlagged` / `Status`) are real columns,
// so "which checklists are incomplete" is answerable natively.
//
// The blob is a KEYED MAP, not a log. Writing an item REPLACES its one slot;
// nothing appends and the blob does not grow with edits. (Contrast
// `Communication`, which genuinely appends.)
//
// MERGING IS LOAD-BEARING. Every write rewrites the whole cell, so two people
// in the same checklist would otherwise last-writer-wins over all 84 answers.
// `mergeAnswers` applies only the keys that actually changed onto whatever
// was read back a moment earlier, so two engineers ticking different items
// both survive. The only lossy case left is two people editing the SAME
// item's findings within the same second, which is what SharePoint gives you
// for any single field anywhere.
//
// FOUR STATES, not a bare tick (Ray, 2026-09-15). The paper form has one
// `Complete` column, where blank silently covers both "doesn't apply" and
// "haven't got to it" - a reader resolves that from the Findings text beside
// it. A progress number can't. Most ECNs never touch chemicals, CSA files or
// panel inventory, so without "N/A" a finished checklist reads as 51 of 84
// for ever and the number stops meaning anything.
// =============================================================================

import {
  ECN_CHECKLIST_ITEMS,
  ECN_CHECKLIST_SECTIONS,
  ECN_CHECKLIST_TEMPLATE_REVISION,
  itemByKey,
  itemsInSection,
  type EcnChecklistItem,
} from "./ecnChecklistTemplate";

/**
 * What an engineer recorded against one item.
 *
 *  - `notStarted`  nobody has answered it yet (the default, never written)
 *  - `complete`    done - the form's `Complete` tick
 *  - `na`          does not apply to this ECN
 *  - `flagged`     needs a department review before the ECN is released
 */
export type EcnChecklistStatus = "notStarted" | "complete" | "na" | "flagged";

export const ECN_CHECKLIST_STATUSES: EcnChecklistStatus[] = [
  "complete",
  "na",
  "flagged",
  "notStarted",
];

/** How each status reads on screen. */
export const ECN_CHECKLIST_STATUS_LABELS: Record<EcnChecklistStatus, string> = {
  complete: "Complete",
  na: "N/A",
  flagged: "Flagged",
  notStarted: "Not started",
};

/** One item's stored answer: the tick box and the comment field, nothing else. */
export interface EcnChecklistAnswer {
  status: EcnChecklistStatus;
  /** The form's "Findings/Comments" column. */
  findings: string;
}

/** The whole `Answers` column, parsed. */
export interface EcnChecklistAnswers {
  /** Which revision of MFGFRM-038 these answers were given against. */
  templateRevision: string;
  /** Keyed by `EcnChecklistItem.key`. Items never answered are absent. */
  items: Record<string, EcnChecklistAnswer>;
}

export const EMPTY_ANSWER: EcnChecklistAnswer = { status: "notStarted", findings: "" };

/** A brand-new, untouched checklist. */
export function emptyAnswers(): EcnChecklistAnswers {
  return { templateRevision: ECN_CHECKLIST_TEMPLATE_REVISION, items: {} };
}

function isStatus(v: unknown): v is EcnChecklistStatus {
  return typeof v === "string" && (ECN_CHECKLIST_STATUSES as string[]).includes(v);
}

/**
 * Parse the stored column.
 *
 * Tolerant on purpose: this value is a text column somebody could in
 * principle edit by hand in SharePoint, and a parse failure must degrade to
 * an empty checklist rather than throwing a detail page away. An unreadable
 * blob is reported through `parseAnswersResult` for a caller that wants to
 * refuse to overwrite it.
 */
export function parseAnswers(raw: string | null | undefined): EcnChecklistAnswers {
  return parseAnswersResult(raw).answers;
}

export interface ParseAnswersResult {
  answers: EcnChecklistAnswers;
  /**
   * True when `raw` held something non-empty that could NOT be read. A caller
   * about to write should refuse rather than replace data it failed to parse.
   */
  corrupt: boolean;
}

export function parseAnswersResult(raw: string | null | undefined): ParseAnswersResult {
  if (!raw || !raw.trim()) return { answers: emptyAnswers(), corrupt: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { answers: emptyAnswers(), corrupt: true };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { answers: emptyAnswers(), corrupt: true };
  }
  const obj = parsed as Record<string, unknown>;
  const rev =
    typeof obj.templateRevision === "string"
      ? obj.templateRevision
      : ECN_CHECKLIST_TEMPLATE_REVISION;
  const rawItems =
    obj.items && typeof obj.items === "object" && !Array.isArray(obj.items)
      ? (obj.items as Record<string, unknown>)
      : {};
  const items: Record<string, EcnChecklistAnswer> = {};
  for (const [key, value] of Object.entries(rawItems)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    const status = isStatus(v.status) ? v.status : "notStarted";
    const findings = typeof v.findings === "string" ? v.findings : "";
    // An item answered "notStarted" with no findings carries no information;
    // dropping it keeps the blob to what was actually recorded.
    if (status === "notStarted" && !findings) continue;
    items[key] = { status, findings };
  }
  return { answers: { templateRevision: rev, items }, corrupt: false };
}

/** Serialise for the `Answers` column. */
export function serialiseAnswers(answers: EcnChecklistAnswers): string {
  return JSON.stringify({
    templateRevision: answers.templateRevision,
    items: answers.items,
  });
}

/** One item's answer, or the untouched default. */
export function answerFor(
  answers: EcnChecklistAnswers,
  key: string,
): EcnChecklistAnswer {
  return answers.items[key] ?? EMPTY_ANSWER;
}

/**
 * Apply a set of per-item changes onto `base`.
 *
 * `base` should be what was just read back from SharePoint, NOT what the
 * editor started from - that is the whole point. Only the keys in `changes`
 * are touched, so a concurrent edit to a different item survives.
 *
 * An item set back to `notStarted` with no findings is REMOVED rather than
 * stored, so clearing an answer leaves no trace and the blob stays the size
 * of what was actually recorded.
 */
export function mergeAnswers(
  base: EcnChecklistAnswers,
  changes: Record<string, EcnChecklistAnswer>,
): EcnChecklistAnswers {
  const items = { ...base.items };
  for (const [key, answer] of Object.entries(changes)) {
    if (answer.status === "notStarted" && !answer.findings.trim()) {
      delete items[key];
      continue;
    }
    items[key] = { status: answer.status, findings: answer.findings };
  }
  return { templateRevision: base.templateRevision, items };
}

// -----------------------------------------------------------------------------
// Progress
// -----------------------------------------------------------------------------

export interface EcnChecklistProgress {
  /** Every item on the CURRENT template (84 on Rev 0). */
  total: number;
  complete: number;
  na: number;
  flagged: number;
  notStarted: number;
  /**
   * Items that still need somebody. Complete and N/A both count as settled -
   * "not applicable" is a real answer, not an outstanding one.
   */
  outstanding: number;
  /** 0-100, over settled items. 100 when nothing is outstanding. */
  percent: number;
  /** True when no item is left `notStarted`. Flagged items still count as settled. */
  finished: boolean;
}

function blankProgress(total: number): EcnChecklistProgress {
  return {
    total,
    complete: 0,
    na: 0,
    flagged: 0,
    notStarted: total,
    outstanding: total,
    percent: 0,
    finished: total === 0,
  };
}

/** Counts over a set of items - the whole template, or one section. */
export function progressFor(
  answers: EcnChecklistAnswers,
  items: EcnChecklistItem[] = ECN_CHECKLIST_ITEMS,
): EcnChecklistProgress {
  const p = blankProgress(items.length);
  p.notStarted = 0;
  for (const item of items) {
    const { status } = answerFor(answers, item.key);
    if (status === "complete") p.complete += 1;
    else if (status === "na") p.na += 1;
    else if (status === "flagged") p.flagged += 1;
    else p.notStarted += 1;
  }
  p.outstanding = p.notStarted;
  p.percent =
    items.length === 0 ? 100 : Math.round(((items.length - p.notStarted) / items.length) * 100);
  p.finished = p.notStarted === 0;
  return p;
}

/** Progress for one section of the form. */
export function sectionProgress(
  answers: EcnChecklistAnswers,
  section: number,
): EcnChecklistProgress {
  return progressFor(answers, itemsInSection(section));
}

/**
 * The overall status a checklist row carries, derived from its answers so the
 * rollup column can never disagree with the blob it summarises.
 */
export type EcnChecklistRowStatus = "Not Started" | "In Progress" | "Complete";

export function statusFromProgress(p: EcnChecklistProgress): EcnChecklistRowStatus {
  if (p.finished) return "Complete";
  if (p.notStarted === p.total) return "Not Started";
  return "In Progress";
}

/**
 * Items the stored answers reference that the CURRENT template no longer
 * declares - i.e. answers given against an older revision of MFGFRM-038.
 *
 * Surfaced rather than dropped: an answer somebody actually recorded must not
 * silently vanish because the form was revised. The UI renders these under a
 * "no longer on the form" heading.
 */
export interface RetiredAnswer {
  key: string;
  answer: EcnChecklistAnswer;
}

export function retiredAnswers(answers: EcnChecklistAnswers): RetiredAnswer[] {
  return Object.entries(answers.items)
    .filter(([key]) => itemByKey(key) === null)
    .map(([key, answer]) => ({ key, answer }));
}

/** True when the answers were given against a different form revision. */
export function isStaleRevision(answers: EcnChecklistAnswers): boolean {
  return answers.templateRevision !== ECN_CHECKLIST_TEMPLATE_REVISION;
}

/** Every section that has at least one item - i.e. all ten, on Rev 0. */
export function sectionsWithItems() {
  return ECN_CHECKLIST_SECTIONS.filter((s) => itemsInSection(s.number).length > 0);
}
