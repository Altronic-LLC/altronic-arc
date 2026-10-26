// =============================================================================
// MCN numbers — MCNyy###: "MCN", the two-digit year, and a three-digit
// sequence that restarts each year (MCN20001, MCN20002, MCN21001 … MCN26001).
// The format is kept from the old SharePoint log (Dave, 2026-10-21) so
// existing numbers keep meaning the same thing.
//
// The next number is the HIGHEST that year + 1, never count + 1 — a count
// slips backwards after a delete and hands a number out twice (the Operations
// task numbering lesson). It must be fed a FRESH read of the list, not a
// cached one; `createMcn` (api/mcns.ts) then checks the saved number and
// renumbers on a collision — the EIR pattern.
// =============================================================================

const MCN_NUMBER = /^MCN(\d{2})(\d{3,})$/i;

/** "MCN26002" → { year: 26, seq: 2 }, or null for anything else. */
export function parseMcnNumber(value: string): { year: number; seq: number } | null {
  const m = MCN_NUMBER.exec(value.trim());
  if (!m) return null;
  return { year: parseInt(m[1], 10), seq: parseInt(m[2], 10) };
}

export function nextMcnNumber(existing: readonly string[], now: Date = new Date()): string {
  const yy = now.getFullYear() % 100;
  let max = 0;
  for (const value of existing) {
    const parsed = parseMcnNumber(value);
    if (parsed && parsed.year === yy && parsed.seq > max) max = parsed.seq;
  }
  return `MCN${String(yy).padStart(2, "0")}${String(max + 1).padStart(3, "0")}`;
}

/** "MCN26002" and "mcn26002 " are the same number. */
export function sameMcnNumber(a: string, b: string): boolean {
  return !!a.trim() && a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** Register order: by year, then sequence — newest first. Unparsable numbers last. */
export function compareMcnNumbers(a: string, b: string): number {
  const x = parseMcnNumber(a);
  const y = parseMcnNumber(b);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  if (x.year !== y.year) return y.year - x.year;
  return y.seq - x.seq;
}
