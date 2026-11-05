import {
  NO_CATEGORY,
  PANEL_BOM_CLUSTERS,
  type PanelBomKit,
  type PanelBomKitComponent,
  type PanelBomLine,
  type PanelBomManualLine,
  type PanelBomPart,
  type PanelBom,
  type PanelBomPicks,
  type PanelBomResult,
} from "@/types/panelBom";

// =============================================================================
// Panel SAP BOM Builder (BusinessIT#59) — the BOM rules, pure.
//
// Ported from Mark Balent's `computeBom()` (dash_template.html), which mirrored
// the formulas in his Excel version. That Excel version retires once ARC is
// live (Tim, 2026-11-05), so this file is now the ONE copy of the rules:
//
//  1. Quantities are summed per SAP # from two sources: parts picked directly,
//     and kit qty × component qty for every kit picked. Picking a kit and one
//     of its components adds them together — that's how extras go on top.
//  2. A kit component with no SAP # is not a BOM line. It is listed to enter
//     in SAP by hand.
//  3. Lines come out in parts-list order (cluster, category, description), one
//     per SAP #.
//  4. Item numbers band by cluster: cluster 0 runs 10, 20, 30…; cluster N
//     starts at N × 1000 and steps by 10.
//
// One change from the standalone tool, on purpose: an SAP # that isn't on the
// parts list (a kit component, or a part retired since a BOM was saved) is
// LISTED, never dropped. The standalone tool skipped it silently, which was
// harmless while the list was a frozen snapshot and is not now that people
// edit it. ARC can't number such a line (it has no cluster), so it goes with
// the hand-entered ones, saying why.
// =============================================================================

/**
 * SAP takes about 28 rows per paste, so a long BOM is copied in blocks: 28
 * first, then 27. Mark's numbers, NOT yet confirmed with somebody who pastes
 * BOMs daily (BusinessIT#59) — change them here and nowhere else.
 */
export const SAP_PASTE_FIRST_BLOCK = 28;
export const SAP_PASTE_NEXT_BLOCKS = 27;

/** Where a cluster's item numbers start. Cluster 0 starts at 10, not 0. */
export function itemNumber(cluster: number, nth: number): number {
  return cluster === 0 ? nth * 10 : cluster * 1000 + (nth - 1) * 10;
}

/** A cluster's name, or a plain label for a number outside the ten. */
export function clusterName(cluster: number): string {
  return PANEL_BOM_CLUSTERS[cluster] ?? `Cluster ${cluster}`;
}

/** Whether a number is one of the ten clusters. */
export function isCluster(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < PANEL_BOM_CLUSTERS.length;
}

const lower = (s: string) => s.toLowerCase();

/** The parts-list order every screen and the BOM use: cluster, category, description. */
export function sortPanelBomParts(parts: readonly PanelBomPart[]): PanelBomPart[] {
  return [...parts].sort(
    (a, b) =>
      a.cluster - b.cluster ||
      lower(a.category).localeCompare(lower(b.category)) ||
      lower(a.description).localeCompare(lower(b.description)) ||
      a.id - b.id,
  );
}

/** Kits by category, then description — the order the workbook listed them. */
export function sortPanelBomKits(kits: readonly PanelBomKit[]): PanelBomKit[] {
  return [...kits].sort(
    (a, b) =>
      lower(a.category).localeCompare(lower(b.category)) ||
      lower(a.description).localeCompare(lower(b.description)) ||
      a.id - b.id,
  );
}

/** Same SAP # whatever the case or stray spaces. */
export function sapKey(sap: string): string {
  return sap.trim().toUpperCase();
}

/** The first row for each SAP # in parts-list order — the row that names, clusters and numbers it. */
export function partsBySap(parts: readonly PanelBomPart[]): Map<string, PanelBomPart> {
  const out = new Map<string, PanelBomPart>();
  for (const p of sortPanelBomParts(parts)) if (!out.has(sapKey(p.sapPartNumber))) out.set(sapKey(p.sapPartNumber), p);
  return out;
}

/**
 * The cluster a kit is shown under: the most common cluster among its
 * components (the Rebuild script's majority vote). A tie goes to the LOWER
 * cluster so the answer never depends on component order; no listed component
 * means cluster 0.
 */
export function kitCluster(kit: PanelBomKit, bySap: Map<string, PanelBomPart>): number {
  const counts = new Map<number, number>();
  for (const c of kit.components) {
    const p = c.sapPartNumber ? bySap.get(sapKey(c.sapPartNumber)) : undefined;
    if (p) counts.set(p.cluster, (counts.get(p.cluster) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [cluster, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (n > bestCount) {
      best = cluster;
      bestCount = n;
    }
  }
  return best;
}

/** Kit qty × component qty can be fractional; keep float noise out of a BOM. */
function tidy(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export const EMPTY_PICKS: PanelBomPicks = { parts: {}, kits: {} };

/**
 * Turn the picks into SAP lines plus the lines that need entering by hand.
 * The heart of the tool — see the rules at the top of this file.
 */
export function computePanelBom(
  parts: readonly PanelBomPart[],
  kits: readonly PanelBomKit[],
  picks: PanelBomPicks,
): PanelBomResult {
  const bySap = partsBySap(parts);
  const kitsByName = new Map(kits.map((k) => [lower(k.name.trim()), k]));
  const totals = new Map<string, number>();
  const unlisted = new Map<string, PanelBomManualLine>();
  const manual: PanelBomManualLine[] = [];

  const add = (sap: string, qty: number, kitName: string | null, description: string) => {
    const key = sapKey(sap);
    if (bySap.has(key)) {
      totals.set(key, (totals.get(key) ?? 0) + qty);
      return;
    }
    const prev = unlisted.get(key);
    if (prev) prev.qty = tidy(prev.qty + qty);
    else unlisted.set(key, { reason: "unlisted", qty: tidy(qty), partNumber: sap.trim(), description, kitName });
  };

  for (const [sap, qty] of Object.entries(picks.parts)) {
    if (qty > 0) add(sap, qty, null, "");
  }
  for (const [name, n] of Object.entries(picks.kits)) {
    if (!(n > 0)) continue;
    const kit = kitsByName.get(lower(name.trim()));
    if (!kit) {
      manual.push({ reason: "unlisted", qty: n, partNumber: name, description: "Kit no longer on the kits list", kitName: null });
      continue;
    }
    for (const c of kit.components) {
      if (c.sapPartNumber.trim()) add(c.sapPartNumber, c.qty * n, kit.name, c.description);
      else manual.push({ reason: "manual", qty: tidy(c.qty * n), partNumber: c.mfgPartNumber, description: c.description, kitName: kit.name });
    }
  }

  const lines: PanelBomLine[] = [];
  const counters = new Map<number, number>();
  // bySap was filled walking the parts in list order, so iterating it IS the
  // list order (rule 3).
  for (const [key, p] of bySap) {
    const qty = totals.get(key);
    if (qty === undefined) continue;
    const nth = (counters.get(p.cluster) ?? 0) + 1;
    counters.set(p.cluster, nth);
    lines.push({ item: itemNumber(p.cluster, nth), qty: tidy(qty), sapPartNumber: p.sapPartNumber, description: p.description, cluster: p.cluster });
  }
  return { lines, manual: [...manual, ...unlisted.values()] };
}

/** The ranges of a BOM copied in SAP-sized blocks: [start, end) pairs. */
export function sapPasteBlocks(
  count: number,
  first = SAP_PASTE_FIRST_BLOCK,
  rest = SAP_PASTE_NEXT_BLOCKS,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = 0;
  while (start < count) {
    const len = start === 0 ? first : rest;
    out.push([start, Math.min(start + len, count)]);
    start += len;
  }
  return out;
}

/** What goes on the clipboard: Item, L, Qty, SAP # — tab-separated, one line each. */
export function sapPasteText(lines: readonly PanelBomLine[]): string {
  return lines.map((l) => [l.item, "L", l.qty, l.sapPartNumber].join("\t")).join("\n");
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The CSV download: Item, L CNT, QTY, SAP Part #, Description. Lines that
 * need entering by hand follow, marked MANUAL (no SAP #) or NOT LISTED.
 */
export function panelBomCsv(result: PanelBomResult): string {
  const rows: Array<Array<string | number>> = [["Item", "L CNT", "QTY", "SAP Part #", "Description"]];
  for (const l of result.lines) rows.push([l.item, "L", l.qty, l.sapPartNumber, l.description]);
  for (const m of result.manual) {
    rows.push([m.reason === "manual" ? "MANUAL" : "NOT LISTED", "", m.qty, m.partNumber, m.description]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** "<Panel System #> - BOM.csv", with characters a file name can't hold removed. */
export function panelBomCsvName(panelSystemNumber: string): string {
  const base = panelSystemNumber.trim().replace(/[\\/:*?"<>|]/g, "-") || "Panel";
  return `${base} - BOM.csv`;
}

/** Same BOM? Compares SAP # and qty per line — what was pasted into SAP. */
export function sameBomLines(a: readonly PanelBomLine[], b: readonly PanelBomLine[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((l, i) => l.item === b[i].item && l.qty === b[i].qty && sapKey(l.sapPartNumber) === sapKey(b[i].sapPartNumber));
}

// -----------------------------------------------------------------------------
// Picks — what the screen edits and a saved BOM stores.
// -----------------------------------------------------------------------------

/** Set one pick. A quantity is a whole number of 0 or more; 0 removes it. */
export function setPick(picks: PanelBomPicks, kind: "parts" | "kits", key: string, qty: number): PanelBomPicks {
  const n = Number.isFinite(qty) ? Math.max(0, Math.floor(qty)) : 0;
  const next = { ...picks[kind] };
  if (n > 0) next[key] = n;
  else delete next[key];
  return { ...picks, [kind]: next };
}

export function pickCount(picks: PanelBomPicks): number {
  return Object.keys(picks.parts).length + Object.keys(picks.kits).length;
}

function positiveRecord(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v > 0) out[k] = v;
  }
  return out;
}

/**
 * Read a stored Picks value. Blank is an empty BOM; anything ARC can't read
 * is `corrupt`, and a save then REFUSES rather than writing over it.
 */
export function parsePicks(raw: unknown): { picks: PanelBomPicks; corrupt: boolean } {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return { picks: { parts: {}, kits: {} }, corrupt: false };
  }
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    const parts = positiveRecord((v as { parts?: unknown }).parts ?? {});
    const kits = positiveRecord((v as { kits?: unknown }).kits ?? {});
    if (!parts || !kits) throw new Error("bad shape");
    return { picks: { parts, kits }, corrupt: false };
  } catch {
    return { picks: { parts: {}, kits: {} }, corrupt: true };
  }
}

export function serializePicks(picks: PanelBomPicks): string {
  return JSON.stringify({ parts: picks.parts, kits: picks.kits });
}

/** The lines snapshot a saved BOM carries — what it looked like when saved. */
export function serializeBomSnapshot(result: PanelBomResult): string {
  return JSON.stringify({ lines: result.lines, manual: result.manual });
}

export function parseBomSnapshot(raw: unknown): PanelBomResult {
  try {
    const v = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : null;
    const lines = Array.isArray(v?.lines) ? (v.lines as PanelBomLine[]).filter((l) => typeof l?.sapPartNumber === "string") : [];
    const manual = Array.isArray(v?.manual) ? (v.manual as PanelBomManualLine[]).filter((m) => typeof m?.qty === "number") : [];
    return { lines, manual };
  } catch {
    // A snapshot is a record of the last save, nothing is decided from it —
    // an unreadable one is shown as empty rather than blocking the BOM.
    return { lines: [], manual: [] };
  }
}

// -----------------------------------------------------------------------------
// Kit components — JSON on the kit row.
// -----------------------------------------------------------------------------

export function parseKitComponents(raw: unknown): { components: PanelBomKitComponent[]; corrupt: boolean } {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return { components: [], corrupt: false };
  }
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(v)) throw new Error("not a list");
    const components = v.map((c: Record<string, unknown>) => {
      const qty = Number(c.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("bad qty");
      return {
        qty,
        sapPartNumber: typeof c.sap === "string" ? c.sap.trim() : "",
        mfgPartNumber: typeof c.mfg === "string" ? c.mfg.trim() : "",
        description: typeof c.desc === "string" ? c.desc.trim() : "",
      };
    });
    return { components, corrupt: false };
  } catch {
    return { components: [], corrupt: true };
  }
}

/** Stored with short keys — the same shape the load script writes. */
export function serializeKitComponents(components: readonly PanelBomKitComponent[]): string {
  return JSON.stringify(
    components.map((c) => ({ qty: c.qty, sap: c.sapPartNumber.trim(), mfg: c.mfgPartNumber.trim(), desc: c.description.trim() })),
  );
}

// -----------------------------------------------------------------------------
// Validation for the parts and kits screens.
// -----------------------------------------------------------------------------

const SAP_FORMAT = /^\d{4}-\d{4}-\d{2}$/;

export interface PanelBomPartInput {
  sapPartNumber: string;
  altronicPartNumber: string;
  description: string;
  cluster: number;
  category: string;
  standard: boolean;
  preferred: boolean;
  doNotQuote: boolean;
  datasheet: string;
  qtyIfUsed: number | null;
  active: boolean;
}

export function panelBomPartProblem(input: PanelBomPartInput): string | null {
  if (!SAP_FORMAT.test(input.sapPartNumber.trim())) return "The SAP part # must read ####-####-##.";
  if (!input.description.trim()) return "Give the part a description.";
  if (!isCluster(input.cluster)) return "Pick a cluster.";
  if (input.qtyIfUsed !== null && !(input.qtyIfUsed > 0)) return "Qty if used must be more than 0, or blank.";
  return null;
}

export interface PanelBomKitInput {
  name: string;
  description: string;
  category: string;
  standard: boolean;
  preferred: boolean;
  active: boolean;
  components: PanelBomKitComponent[];
}

export function panelBomKitProblem(input: PanelBomKitInput, otherKitNames: readonly string[]): string | null {
  const name = input.name.trim();
  if (!name) return "Give the kit a name.";
  if (otherKitNames.some((n) => lower(n.trim()) === lower(name))) return `A kit called ${name} already exists.`;
  if (input.components.length === 0) return "A kit needs at least one component.";
  for (const [i, c] of input.components.entries()) {
    if (!(c.qty > 0)) return `Component ${i + 1}: the quantity must be more than 0.`;
    if (c.sapPartNumber.trim() && !SAP_FORMAT.test(c.sapPartNumber.trim())) {
      return `Component ${i + 1}: the SAP part # must read ####-####-##, or be blank to enter it in SAP by hand.`;
    }
    if (!c.sapPartNumber.trim() && !c.description.trim()) {
      return `Component ${i + 1}: a component with no SAP # needs a description, so it can be entered by hand.`;
    }
  }
  return null;
}

/** A blank category reads as the workbook's "(No Category)". */
export function categoryOrDefault(category: string): string {
  return category.trim() || NO_CATEGORY;
}

// -----------------------------------------------------------------------------
// The picker — what's shown.
// -----------------------------------------------------------------------------

export interface PanelBomFilters {
  search: string;
  preferredOnly: boolean;
  standardOnly: boolean;
  hideDoNotQuote: boolean;
}

function matchesSearch(search: string, ...fields: string[]): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Whether a part shows in the picker. A picked part ALWAYS shows — a retired
 * or Do Not Quote part already on the BOM must stay where its quantity can be
 * seen and changed.
 */
export function partShown(part: PanelBomPart, filters: PanelBomFilters, picked: boolean): boolean {
  if (!picked) {
    if (!part.active) return false;
    if (filters.hideDoNotQuote && part.doNotQuote) return false;
    if (filters.preferredOnly && !part.preferred) return false;
    if (filters.standardOnly && !part.standard) return false;
  }
  return matchesSearch(filters.search, part.sapPartNumber, part.altronicPartNumber, part.description, part.category);
}

export function kitShown(kit: PanelBomKit, filters: PanelBomFilters, picked: boolean): boolean {
  if (!picked) {
    if (!kit.active) return false;
    if (filters.preferredOnly && !kit.preferred) return false;
    if (filters.standardOnly && !kit.standard) return false;
  }
  return matchesSearch(filters.search, kit.name, kit.description, kit.category);
}

// -----------------------------------------------------------------------------
// Cost — from SAP through Fabric, per viewer. Never stored.
// -----------------------------------------------------------------------------

/** A kit's cost from its components' SAP costs; `missing` counts components with none. */
export function kitCost(kit: PanelBomKit, costs: ReadonlyMap<string, number | null>): { cost: number; missing: number } {
  let cost = 0;
  let missing = 0;
  for (const c of kit.components) {
    const unit = c.sapPartNumber ? costs.get(sapKey(c.sapPartNumber)) : undefined;
    if (unit === undefined || unit === null) missing++;
    else cost += unit * c.qty;
  }
  return { cost, missing };
}

/** The BOM's estimated cost; `missing` counts lines SAP has no cost for. */
export function bomCost(lines: readonly PanelBomLine[], costs: ReadonlyMap<string, number | null>): { cost: number; missing: number } {
  let cost = 0;
  let missing = 0;
  for (const l of lines) {
    const unit = costs.get(sapKey(l.sapPartNumber));
    if (unit === undefined || unit === null) missing++;
    else cost += unit * l.qty;
  }
  return { cost, missing };
}

/** The saved BOMs pointing at one Panel Order — the link is stored on the BOM only. */
export function bomsForOrder(boms: readonly PanelBom[], orderId: number): PanelBom[] {
  return boms
    .filter((b) => b.panelOrder?.lookupId === orderId)
    .sort((a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0));
}

/** For a cost lookup by SAP # from a screen. */
export function costOf(costs: ReadonlyMap<string, number | null> | null, sap: string): number | null {
  return costs?.get(sapKey(sap)) ?? null;
}
