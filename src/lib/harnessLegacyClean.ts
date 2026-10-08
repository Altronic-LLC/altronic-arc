// =============================================================================
// Cleaning the legacy Harness Production Report (an Access table exported to
// CSV) before it is loaded into the "Harness Production Log" SharePoint list.
//
// Pure, with no clock of its own — `today` is passed in — so every rule here is
// pinned by harnessLegacyClean.test.ts. The runner is
// scripts/clean-harness-production-log.mjs, which bundles this file with
// esbuild the way the Open Orders sample generator does.
//
// Not imported by the app. It lives in src/ only so Vitest covers it; the app
// bundle never reaches it.
//
// THE RULE THAT SHAPES ALL OF IT: fix what is unambiguous, FLAG everything
// else, and never throw a value away. Every change to a row is written into its
// DataQualityNotes with the original text, so the load is auditable row by row
// and nothing the floor typed is lost — only moved to where it can't mislead.
//
// What the export looked like (22,184 rows, profiled 2026-10-08):
//  - Dates typed by hand: M/D/YYYY until late 2021, then M/D/YY, plus M/D with
//    no year at all, and typos ("5/28/20214", "10/8/269", "2/202026").
//  - Part numbers typed by hand: 1,310 distinct spellings for far fewer parts —
//    case, stray `*` `=` `+` `/` and backticks, missing dashes, a doubled or
//    dropped digit, and Waukesha customer numbers typed in place of ours.
//  - Nine setup/test rows at the top (clock "KN", part 999888, WO 10222222).
// =============================================================================

import { HARNESS_FIRST_YEAR } from "./harnessLogMapper";

/** One row of the raw export, by column position. */
export interface LegacyHarnessRow {
  /** 1-based line number in the CSV (the header is line 1). */
  line: number;
  date: string;
  workOrder: string;
  partNumber: string;
  qty: string;
  reworkQty: string;
  comments: string;
  clockNumber: string;
  visualCheck: string;
  field1: string;
}

export interface CleanHarnessRow {
  /** Stable key for an idempotent load — see `legacySourceKey`. */
  legacySource: string;
  line: number;
  /** yyyy-mm-dd, or null only when nothing before it had a date either. */
  date: string | null;
  workOrder: string;
  partNumber: string | null;
  quantity: number | null;
  reworkQuantity: number | null;
  comments: string;
  builtBy: string;
  visualCheck: string;
  notes: string[];
}

export interface CleanHarnessPart {
  partNumber: string;
  uses: number;
  firstUsed: string | null;
  lastUsed: string | null;
  active: boolean;
  note: string;
}

export interface CleanHarnessResult {
  rows: CleanHarnessRow[];
  parts: CleanHarnessPart[];
  /** Rows deliberately left out (blank lines, the setup/test rows). */
  excluded: Array<{ line: number; reason: string }>;
  /** raw spelling → what it became, for the change report. */
  partChanges: Array<{ from: string; to: string | null; rows: number; rule: string }>;
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

/** RFC-4180-ish parse: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV text → typed legacy rows. The header row is skipped, not trusted. */
export function readLegacyRows(text: string): LegacyHarnessRow[] {
  return parseCsv(text)
    .slice(1)
    .map((r, i) => ({
      line: i + 2,
      date: r[0] ?? "",
      workOrder: r[1] ?? "",
      partNumber: r[2] ?? "",
      qty: r[3] ?? "",
      reworkQty: r[4] ?? "",
      comments: r[5] ?? "",
      clockNumber: r[6] ?? "",
      visualCheck: r[7] ?? "",
      field1: r[8] ?? "",
    }));
}

// -----------------------------------------------------------------------------
// Dates
// -----------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** How far a typed date may sit from its neighbours and still be believed. */
export const DATE_TOLERANCE_DAYS = 60;
/** Neighbouring rows either side used to judge a date. */
const DATE_WINDOW = 10;
/** The Access database went live in 2018; nothing earlier is real. */
export const FIRST_YEAR = HARNESS_FIRST_YEAR;

interface ParsedDate {
  month: number;
  day: number;
  /** null when no year was typed, or the year was garbage. */
  year: number | null;
}

/**
 * Read a hand-typed date into its parts. Never guesses a year: "10/8/269" gives
 * month 10, day 8, year null, and the neighbours decide the year.
 */
export function parseTypedDate(raw: string): ParsedDate | null {
  // "6-29-22", "3/12-22" and "8//1/22" are all typed by hand on this table.
  const s = raw.trim().replace(/[*\s]/g, "").replace(/[-.]/g, "/").replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d*))?$/.exec(s);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const y = m[3] ?? "";
  let year: number | null = null;
  if (y.length === 4) year = Number(y);
  else if (y.length === 2) year = 2000 + Number(y);
  return { month, day, year };
}

/** Days since the epoch for a calendar date, or null if it doesn't exist (2/30). */
export function dayNumber(year: number, month: number, day: number): number | null {
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return Math.round(t / DAY_MS);
}

export function isoFromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Settle every row's date, in file order.
 *
 * The table was appended to as work was done, so a row's neighbours are the
 * best evidence of when it happened. A typed date is BELIEVED when it has a
 * plausible year and sits within `DATE_TOLERANCE_DAYS` of the median of its
 * believable neighbours. Anything else is repaired, in this order:
 *
 *  1. the same month/day in the neighbours' year, the year before or after —
 *     "12/4" with no year, "10/8/269", "5/28/20214";
 *  2. a month that lost a digit ("1/15/2018" among October rows is 10/15);
 *  3. month and day swapped;
 *  4. a complete, real date none of that explains is kept as typed — more
 *     likely a row entered out of order than a typo;
 *  5. failing all of that, the previous row's date — the row is still loaded,
 *     and the note says the date is a stand-in.
 *
 * A blank date takes the previous row's, which is what the floor meant by
 * leaving it blank.
 */
export function settleDates(
  raws: string[],
  today: string,
): Array<{ date: string | null; note: string | null }> {
  const todayN = Math.round(Date.parse(`${today}T00:00:00Z`) / DAY_MS);
  const parsed = raws.map(parseTypedDate);
  const plausible = parsed.map((p) => {
    if (!p || p.year === null || p.year < FIRST_YEAR) return null;
    const n = dayNumber(p.year, p.month, p.day);
    return n !== null && n <= todayN ? n : null;
  });

  const reference = (i: number): number | null => {
    const near: number[] = [];
    for (let j = Math.max(0, i - DATE_WINDOW); j <= Math.min(raws.length - 1, i + DATE_WINDOW); j++) {
      if (j !== i && plausible[j] !== null) near.push(plausible[j] as number);
    }
    return median(near);
  };
  const close = (n: number, ref: number) => Math.abs(n - ref) <= DATE_TOLERANCE_DAYS && n <= todayN;

  const out: Array<{ date: string | null; note: string | null }> = [];
  let previous: number | null = null;
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i].trim();
    const p = parsed[i];
    const ref = reference(i);
    let settled: number | null = null;
    let note: string | null = null;

    if (!raw) {
      settled = previous;
      note = "Date was blank — took the previous row's date.";
    } else if (plausible[i] !== null && (ref === null || close(plausible[i] as number, ref))) {
      settled = plausible[i];
    } else {
      const candidates: number[] = [];
      if (p && ref !== null) {
        const refYear = new Date(ref * DAY_MS).getUTCFullYear();
        // Groups of readings, most literal first. A one-digit month may have
        // lost a digit: "1" for 10, 11 or 12, "2" for 12.
        const monthSlips = [10, 11, 12].filter((m) => String(m).includes(String(p.month)) && p.month <= 2);
        const groups: Array<Array<[number, number]>> = [
          [[p.month, p.day]],
          monthSlips.map((m): [number, number] => [m, p.day]),
          p.day <= 12 ? [[p.day, p.month]] : [],
        ];
        for (const shapes of groups) {
          for (const [mo, d] of shapes) {
            for (const y of [refYear - 1, refYear, refYear + 1]) {
              const n = dayNumber(y, mo, d);
              if (n !== null && close(n, ref)) candidates.push(n);
            }
          }
          // The first group that fits wins — a literal reading beats a repair.
          if (candidates.length) break;
        }
      }
      if (candidates.length) {
        settled = candidates.reduce((best, n) =>
          Math.abs(n - (ref as number)) < Math.abs(best - (ref as number)) ? n : best,
        );
        note = `Date typed as "${raw}" — read as ${isoFromDayNumber(settled)} from the rows around it.`;
      } else if (plausible[i] !== null) {
        // A complete, real date that no repair explains is more likely a row
        // entered out of order than a typo — keep what was typed.
        settled = plausible[i];
        note = `Date "${raw}" is far from the rows around it — kept as typed.`;
      } else {
        settled = previous ?? ref;
        note = `Date typed as "${raw}" couldn't be read — took ${
          settled === null ? "nothing" : isoFromDayNumber(settled)
        } from the row before it.`;
      }
    }
    if (settled !== null) previous = settled;
    out.push({ date: settled === null ? null : isoFromDayNumber(settled), note });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Part numbers
// -----------------------------------------------------------------------------

/**
 * What a real part number looks like. A spelling matching none of these is
 * MALFORMED, and only a malformed spelling is ever corrected by similarity — a
 * well-formed rare number might be a real part used twice, and "correcting" it
 * to its neighbour would merge two parts.
 */
const PART_SHAPES: RegExp[] = [
  /^\d{6}[A-Z]{0,2}(-[0-9A-Z]{1,6}){0,2}$/, // 593027-15, 793089B-1, 593826-231-1Z
  /^EC\d{5}(-\d{1,2})?$/, // EC93005-5 (Waukesha ignition harnesses)
  /^\d{1,2}-\d{6}-\d{3}$/, // 6-220303-001
  /^\d{4}-\d{4}-\d{2}$/, // 1013-4714-00
  /^29-\d{6}-\d{3}$/, // 29-126879-003
  /^G11012[A-Z]?$/,
  /^60T-\d{6}[A-Z]?$/,
  /^SKETCH #\d+(-\d+)?$/,
];

export function isWellFormedPart(pn: string): boolean {
  return PART_SHAPES.some((re) => re.test(pn));
}

/**
 * Waukesha's own part numbers, typed in place of ours. The mapping was read
 * off the rows' own comments ("295495B / EC93005-2"), not guessed.
 */
export const WAUKESHA_TO_ALTRONIC: Record<string, string> = {
  "295495B": "EC93005-2",
  "295495F": "EC93005-5",
  "295495G": "EC93005-6",
  "295495D": "EC93005-4",
  "295495": "EC93015-1",
  "295495E": "EC93015-3",
  "295841J": "EC93016-1",
  "295841S": "EC93025-1",
  "295841N": "EC93025-2",
  "295497P": "EC93018-3",
  "295497N": "EC93024-2",
  "295841E": "EC93014-1",
  "295841L": "EC93009-4",
  "295841A": "EC93002-1",
  "295841B": "EC93002-2",
  "295841G": "EC93014-2",
  "740221D": "EC93023-1",
  "740221E": "EC93023-2",
  "740221": "EC93004-2",
};

/** Typos specific enough that no general rule should be trusted to make them. */
export const EXPLICIT_PART_FIXES: Record<string, string> = {
  "593072-KY": "593072-KT",
  "60T-064176": "60T-064176L",
  "60T-604176L": "60T-064176L",
  "EC3005-5": "EC93005-5",
  "EC3005-4": "EC93005-4",
  "EC3009-4": "EC93009-4",
  "EC9316-1": "EC93016-1",
};

/**
 * The repairs that change no meaning: case, stray punctuation, spacing.
 * Returns "" for a value that is nothing but punctuation ("-", "*").
 */
export function mechanicalPart(raw: string): string {
  let s = raw.toUpperCase().trim();
  s = s.replace(/[*+`]/g, "");
  s = s.replace(/=/g, "-").replace(/\//g, "-");
  s = s.replace(/(\d)\.(\d)/g, "$1-$2");
  s = s.replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
  s = s.replace(/-{2,}/g, "-");
  s = s.replace(/^[-.\s]+|[-.\s]+$/g, "");
  s = s.replace(/^6OT/, "60T");
  s = s.replace(/^0(\d)-/, "$1-");
  s = s.replace(/^1012-(47\d\d)-00$/, "1013-$1-00");
  return s;
}

const stripDashes = (s: string) => s.replace(/-/g, "");

/** True when `a` and `b` differ by exactly one insert, delete or substitute. */
export function oneEditApart(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  return a.slice(i) === b.slice(i + 1);
}

/** Uses at or above which a well-formed spelling is trusted as a real part. */
export const KNOWN_PART_MIN_USES = 3;

interface PartDecision {
  to: string | null;
  rule: string;
  flagged: boolean;
}

/**
 * Decide what every distinct part spelling becomes.
 *
 * Takes the spellings AFTER the mechanical pass and the two fixed maps, with
 * how often each was used. A spelling used `KNOWN_PART_MIN_USES` times or more
 * and well-formed is KNOWN; everything else is checked against the known set:
 *
 *  - same characters ignoring dashes ("59305248" → "593052-48");
 *  - a bare base with exactly one known variant ("793142" → "793142-1");
 *  - malformed AND one edit from exactly one spelling in the data, which is a
 *    known part ("6930008-10").
 *
 * An ambiguous or unmatched malformed spelling is kept as typed and flagged.
 */
export function decidePartSpellings(counts: Map<string, number>): Map<string, PartDecision> {
  const known = [...counts]
    .filter(([pn, n]) => n >= KNOWN_PART_MIN_USES && isWellFormedPart(pn))
    .map(([pn]) => pn);
  const knownSet = new Set(known);
  const wellFormed = [...counts.keys()].filter(isWellFormedPart);
  const byDashless = new Map<string, string[]>();
  for (const k of known) {
    const key = stripDashes(k);
    byDashless.set(key, [...(byDashless.get(key) ?? []), k]);
  }

  const decisions = new Map<string, PartDecision>();
  for (const [pn, n] of counts) {
    if (n >= KNOWN_PART_MIN_USES && isWellFormedPart(pn)) {
      decisions.set(pn, { to: pn, rule: "known", flagged: false });
      continue;
    }
    const dashTwin = (byDashless.get(stripDashes(pn)) ?? []).filter((k) => k !== pn);
    if (dashTwin.length === 1) {
      decisions.set(pn, { to: dashTwin[0], rule: "dash placement", flagged: false });
      continue;
    }
    if (/^\d{6}$/.test(pn)) {
      const variants = known.filter((k) => k.startsWith(`${pn}-`));
      if (variants.length === 1) {
        decisions.set(pn, { to: variants[0], rule: "missing suffix", flagged: false });
        continue;
      }
    }
    if (!isWellFormedPart(pn)) {
      // Near ANY well-formed spelling in the data, not only the known ones:
      // "5931542-36" is one edit from known 593152-36 AND from 593154-36, used
      // once — so which was meant is genuinely open, and it is flagged.
      const near = wellFormed.filter((k) => oneEditApart(pn, k));
      // A run of digits with no dash ("5930502") is as likely a missing dash
      // as an extra digit; only the dash rule above may settle one.
      const repairable = !/^\d{7,}$/.test(pn);
      if (repairable && near.length === 1 && knownSet.has(near[0])) {
        decisions.set(pn, { to: near[0], rule: "one-character typo", flagged: false });
      } else {
        decisions.set(pn, {
          to: pn,
          rule: near.length ? `ambiguous (${near.join(" / ")})` : "unrecognised",
          flagged: true,
        });
      }
      continue;
    }
    decisions.set(pn, { to: pn, rule: "rare but well-formed", flagged: false });
  }
  return decisions;
}

// -----------------------------------------------------------------------------
// Work orders and the other fields
// -----------------------------------------------------------------------------

const WO_SHAPE = /^1\d{9}$/;

/** Tidy a typed work order. Never invents one; odd ones are kept and flagged. */
export function cleanWorkOrder(raw: string): { value: string; odd: boolean } {
  let s = raw.trim().replace(/^[.\s]+/, "").replace(/[.\\`\s]+$/, "");
  if (/^parts\s*order$/i.test(s)) return { value: "PARTS ORDER", odd: false };
  if (/^(n\/?a|\?+|-+)$/i.test(s)) s = "";
  return { value: s, odd: s !== "" && !WO_SHAPE.test(s) };
}

/** A whole number, or null. `"12 "` → 12, `"twelve"` → null. */
export function readCount(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Initials and clock numbers: upper-case, trimmed, a lone "." is nothing. */
export function cleanCode(raw: string): string {
  const s = raw.trim().toUpperCase();
  return s === "." ? "" : s;
}

/**
 * The idempotency key a re-run of the load matches on. Built from the row's
 * RAW values (plus a counter for genuine duplicates), never its line number:
 * a fresh export can come out in a different order, and the old Access
 * database stays in use until cutover, so the load will be topped up.
 */
export function legacySourceKey(row: LegacyHarnessRow, occurrence: number): string {
  const parts = [row.date, row.workOrder, row.partNumber, row.qty, row.reworkQty, row.clockNumber]
    .map((v) => v.trim())
    .join("|");
  return `ACCESS:${parts}#${occurrence}`.slice(0, 255);
}

/** The table's first nine rows were somebody trying the database out. */
function isSetupRow(row: LegacyHarnessRow, seenRealWorkOrder: boolean): boolean {
  return !seenRealWorkOrder && !WO_SHAPE.test(row.workOrder.trim());
}

const REWORK_CEILING = 1000;

// -----------------------------------------------------------------------------
// The whole pass
// -----------------------------------------------------------------------------

export function cleanHarnessExport(
  legacy: LegacyHarnessRow[],
  options: { today: string; activeSinceMonths?: number },
): CleanHarnessResult {
  const excluded: CleanHarnessResult["excluded"] = [];
  const kept: LegacyHarnessRow[] = [];
  let seenReal = false;
  for (const row of legacy) {
    const values = [row.date, row.workOrder, row.partNumber, row.qty, row.reworkQty, row.comments,
      row.clockNumber, row.visualCheck, row.field1];
    if (values.every((v) => !v.trim())) {
      excluded.push({ line: row.line, reason: "blank row" });
      continue;
    }
    if (isSetupRow(row, seenReal)) {
      excluded.push({ line: row.line, reason: "setup/test row before the first real work order" });
      continue;
    }
    if (WO_SHAPE.test(row.workOrder.trim())) seenReal = true;
    kept.push(row);
  }

  const dates = settleDates(kept.map((r) => r.date), options.today);

  // Work order ↔ part number: swapped fields, and both glued into one.
  const fields = kept.map((row) => {
    const notes: string[] = [];
    let wo = row.workOrder.trim();
    let part = row.partNumber.trim();
    const glued = /^(1\d{9})(\d{6}-[0-9A-Z]+)$/i;
    for (const [src, label] of [[wo, "WO"], [part, "Part Number"]] as const) {
      const g = glued.exec(src);
      if (g) {
        wo = g[1];
        part = g[2];
        notes.push(`${label} held "${src}" — split into WO ${g[1]} and part ${g[2]}.`);
        break;
      }
    }
    if (WO_SHAPE.test(part) && !WO_SHAPE.test(wo) && isWellFormedPart(mechanicalPart(wo))) {
      notes.push(`WO and Part Number were swapped ("${row.workOrder.trim()}" / "${row.partNumber.trim()}").`);
      [wo, part] = [part, wo];
    } else if (WO_SHAPE.test(part)) {
      notes.push(`Part Number held a work order number ("${part}") — part left blank.`);
      part = "";
    }
    return { wo, part, notes };
  });

  // Part spellings: mechanical, then the fixed maps, then the similarity pass.
  const spelled = fields.map((f) => {
    const m = mechanicalPart(f.part);
    const mapped = WAUKESHA_TO_ALTRONIC[m] ?? EXPLICIT_PART_FIXES[m] ?? m;
    return { raw: f.part, mechanical: m, mapped };
  });
  const counts = new Map<string, number>();
  for (const s of spelled) if (s.mapped) counts.set(s.mapped, (counts.get(s.mapped) ?? 0) + 1);
  const decisions = decidePartSpellings(counts);

  const changeTally = new Map<string, { to: string | null; rows: number; rule: string }>();
  const tally = (from: string, to: string | null, rule: string) => {
    const key = `${from}→${to}`;
    const cur = changeTally.get(key);
    if (cur) cur.rows++;
    else changeTally.set(key, { to, rows: 1, rule });
  };

  const occurrences = new Map<string, number>();
  const rows: CleanHarnessRow[] = kept.map((row, i) => {
    const notes = [...fields[i].notes];
    if (dates[i].note) notes.push(dates[i].note as string);

    const { raw, mechanical, mapped } = spelled[i];
    let partNumber: string | null = null;
    if (!mapped) {
      if (raw) notes.push(`Part Number "${raw}" was only punctuation — left blank.`);
      else if (!fields[i].notes.some((n) => n.startsWith("Part Number held"))) {
        notes.push("Part Number was blank.");
      }
    } else {
      const d = decisions.get(mapped) as PartDecision;
      partNumber = d.to;
      let rule = d.rule;
      if (WAUKESHA_TO_ALTRONIC[mechanical]) rule = "Waukesha number";
      else if (EXPLICIT_PART_FIXES[mechanical]) rule = "known typo";
      else if (d.to === mechanical) rule = mechanical === raw ? "" : "tidied";
      if (partNumber !== raw && rule) {
        notes.push(`Part Number typed as "${raw}" — recorded as ${partNumber} (${rule}).`);
      }
      if (d.flagged) notes.push(`Part Number "${partNumber}" isn't a recognised part — check it.`);
      if (partNumber !== raw) tally(raw, partNumber, rule || "tidied");
    }

    const wo = cleanWorkOrder(fields[i].wo);
    if (wo.value !== fields[i].wo && fields[i].wo) {
      notes.push(`WO typed as "${fields[i].wo}" — recorded as "${wo.value}".`);
    }
    if (wo.odd) notes.push(`WO "${wo.value}" isn't a ten-digit work order — kept as typed.`);

    const quantity = readCount(row.qty);
    if (quantity === null && row.qty.trim()) notes.push(`Qty "${row.qty.trim()}" isn't a number — left blank.`);
    if (!row.qty.trim()) notes.push("Qty was blank.");
    let reworkQuantity = readCount(row.reworkQty);
    if (reworkQuantity === null && row.reworkQty.trim()) {
      notes.push(`Rework Qty "${row.reworkQty.trim()}" isn't a number — left blank.`);
    }
    if (reworkQuantity !== null && reworkQuantity > REWORK_CEILING) {
      notes.push(`Rework Qty ${reworkQuantity} is implausible — left blank.`);
      reworkQuantity = null;
    }
    if (reworkQuantity !== null && quantity !== null && reworkQuantity > quantity) {
      notes.push(`Rework Qty (${reworkQuantity}) is more than Qty (${quantity}).`);
    }
    if (row.field1.trim()) notes.push(`An unnamed extra column held "${row.field1.trim()}".`);

    const base = legacySourceKey(row, 0).replace(/#0$/, "");
    const n = occurrences.get(base) ?? 0;
    occurrences.set(base, n + 1);

    return {
      legacySource: legacySourceKey(row, n),
      line: row.line,
      date: dates[i].date,
      workOrder: wo.value,
      partNumber,
      quantity,
      reworkQuantity,
      comments: row.comments.trim(),
      builtBy: cleanCode(row.clockNumber),
      visualCheck: cleanCode(row.visualCheck),
      notes,
    };
  });

  return {
    rows,
    parts: summariseParts(rows, decisions, options.today, options.activeSinceMonths ?? 24),
    excluded,
    partChanges: [...changeTally]
      .map(([key, v]) => ({ from: key.slice(0, key.indexOf("→")), ...v }))
      .sort((a, b) => b.rows - a.rows),
  };
}

/**
 * One entry per distinct cleaned part number, with when it was last built.
 *
 * ACTIVE means built in the last `months` months, and not flagged. A part
 * nobody has built in two years, or a spelling that was never recognised,
 * stays on the list — old rows point at it — but is left out of the New entry
 * picker until an admin brings it back.
 */
export function summariseParts(
  rows: CleanHarnessRow[],
  decisions: Map<string, PartDecision>,
  today: string,
  months: number,
): CleanHarnessPart[] {
  const cut = new Date(`${today}T00:00:00Z`);
  cut.setUTCMonth(cut.getUTCMonth() - months);
  const cutoff = cut.toISOString().slice(0, 10);
  const flagged = new Set([...decisions.values()].filter((d) => d.flagged).map((d) => d.to));

  const byPart = new Map<string, CleanHarnessPart>();
  for (const r of rows) {
    if (!r.partNumber) continue;
    const p = byPart.get(r.partNumber) ?? {
      partNumber: r.partNumber,
      uses: 0,
      firstUsed: null,
      lastUsed: null,
      active: false,
      note: "",
    };
    p.uses++;
    if (r.date && (!p.firstUsed || r.date < p.firstUsed)) p.firstUsed = r.date;
    if (r.date && (!p.lastUsed || r.date > p.lastUsed)) p.lastUsed = r.date;
    byPart.set(r.partNumber, p);
  }
  for (const p of byPart.values()) {
    if (flagged.has(p.partNumber)) {
      p.note = "Spelling from the old Access database that matches no known part — check before reusing.";
    } else {
      p.active = !!p.lastUsed && p.lastUsed >= cutoff;
      if (!p.active) p.note = `Not built since ${p.lastUsed ?? "an unknown date"} — retired on import.`;
    }
  }
  return [...byPart.values()].sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
}
