import type { NewProductRevision, PricingHistoryEntry } from "@/types/pricing";

// =============================================================================
// The JSON history columns — Pricing History's `History` (one entry per
// pricing of a request) and New Product Pricing's `History` (one full snapshot
// per revision). Pure.
//
// The ECN checklist's `Answers` rules apply (Ray asked for JSON that can be
// parsed out, 2026-10-13):
//   * A value we could NOT PARSE is never overwritten. `parse*` reports
//     `corrupt`, and the write refuses, saying so — replacing data we failed
//     to read is the one outcome worse than an error message.
//   * A request's history is APPEND-only. A worksheet's is keyed by revision:
//     a plain Save replaces the CURRENT revision's entry, "Save as new
//     revision" appends the next one. An earlier revision is never rewritten.
//   * Blank means an empty history, not a corrupt one.
// =============================================================================

export class HistoryUnreadableError extends Error {
  constructor(what: string) {
    super(
      `The saved ${what} history couldn't be read, so ARC won't write over it. ` +
        "Check the History column on that row in SharePoint before trying again.",
    );
    this.name = "HistoryUnreadableError";
  }
}

function parseArray(raw: unknown): { entries: unknown[]; corrupt: boolean } {
  if (raw === null || raw === undefined) return { entries: [], corrupt: false };
  if (typeof raw !== "string") return { entries: [], corrupt: true };
  if (!raw.trim()) return { entries: [], corrupt: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? { entries: parsed, corrupt: false } : { entries: [], corrupt: true };
  } catch {
    return { entries: [], corrupt: true };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A request's pricing history. Entries that aren't objects are dropped, not fatal. */
export function parsePricingHistory(raw: unknown): { entries: PricingHistoryEntry[]; corrupt: boolean } {
  const { entries, corrupt } = parseArray(raw);
  return {
    entries: entries.filter(
      (e): e is PricingHistoryEntry => isObject(e) && typeof e.pricedAt === "string" && typeof e.listPrice === "number",
    ),
    corrupt,
  };
}

/** The stored value with `entry` appended. Throws rather than replacing an unreadable value. */
export function appendPricingHistory(raw: unknown, entry: PricingHistoryEntry): string {
  const { entries, corrupt } = parsePricingHistory(raw);
  if (corrupt) throw new HistoryUnreadableError("price");
  return JSON.stringify([...entries, entry]);
}

/** A worksheet's revision history, oldest first. */
export function parseRevisionHistory(raw: unknown): { entries: NewProductRevision[]; corrupt: boolean } {
  const { entries, corrupt } = parseArray(raw);
  return {
    entries: entries
      .filter((e): e is NewProductRevision => isObject(e) && typeof e.rev === "number" && Array.isArray(e.subAssemblies))
      .sort((a, b) => a.rev - b.rev),
    corrupt,
  };
}

/**
 * The stored value with `snapshot` saved: replacing the entry for its rev if
 * there is one (a plain Save), appending otherwise (a new revision). Refuses
 * to touch an EARLIER revision — only the latest may be replaced.
 */
export function saveRevisionHistory(raw: unknown, snapshot: NewProductRevision): string {
  const { entries, corrupt } = parseRevisionHistory(raw);
  if (corrupt) throw new HistoryUnreadableError("revision");
  const latest = entries.length ? entries[entries.length - 1].rev : 0;
  if (snapshot.rev < latest) {
    throw new Error(`R${snapshot.rev} is an earlier revision — only R${latest} can be saved over.`);
  }
  const kept = entries.filter((e) => e.rev !== snapshot.rev);
  return JSON.stringify([...kept, snapshot].sort((a, b) => a.rev - b.rev));
}
