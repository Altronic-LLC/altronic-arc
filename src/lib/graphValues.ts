// =============================================================================
// Reading values out of Graph `item.fields` — shared by every department.
// Lifted out of lib/teradyneMapper.ts (which still re-exports them) when the
// Harness department moved out of Operations, so Harness code doesn't import
// an Operations module (CLAUDE.md: no cross-department imports).
// =============================================================================

/** Coerce a Graph number field (which arrives as number OR numeric string). */
export function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a lookup id field (Graph hands these back as strings: "201"). */
export function toLookupId(raw: unknown): number | null {
  const n = toNumberOrNull(raw);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}
