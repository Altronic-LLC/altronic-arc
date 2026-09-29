import type { ComponentDescriptionOption, ComponentDescriptionOptionKind } from "@/types/task";
import seed from "@/data/componentDescriptionSeed.json";

// =============================================================================
// A new component's Description is PICKED, not typed. That's how the old Power
// App worked (Tim, 2026-09-28): a Description dropdown, then a Type dropdown
// limited to that Description's types, and the two joined on save
// ("CAPACITOR - CERAMIC"). On the 722 list a SIL category comes first (Tim,
// 2026-09-29): "SIL CAT 1 - CAPACITOR - CERAMIC".
//
// The options live on a SharePoint list, the Component Description Options
// list, so the SAP admin and the reviewing engineers can change them in ARC
// without a code change. These are the pure rules; api/componentDescriptionOptions.ts
// stores them.
//
// Three rules are load-bearing:
//   - The saved text is UPPER CASE, joined with " - ". That's how 1,868 of
//     the 1,908 existing rows that match a pair are written, and it's the
//     shape componentRatings.ts reads the part's type from.
//   - Only a NEW component uses the dropdowns. Editing an existing one keeps
//     the plain text box (Tim, 2026-09-29), because about half of today's
//     descriptions aren't a pair and an edit must not rewrite them.
//   - A part stores the TEXT, not a pointer to an option. So an option can be
//     renamed or removed and no part changes; it just stops being offered.
// =============================================================================

/** The separator between the picks, and the one the existing data uses. */
export const DESCRIPTION_SEPARATOR = " - ";

/** A stored Types value, one type per line, into an ordered list. Blanks and repeats are dropped. */
export function parseTypes(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = cleanOptionName(line);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** Types back to the stored value. */
export function serializeTypes(types: readonly string[]): string {
  return parseTypes(types.join("\n")).join("\n");
}

/** One kind's options, in their order: SortOrder, then name. */
export function optionsOfKind(
  options: readonly ComponentDescriptionOption[],
  kind: ComponentDescriptionOptionKind,
): ComponentDescriptionOption[] {
  return options
    .filter((o) => o.kind === kind)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** The SortOrder for a new option: after the last of its kind. */
export function nextSortOrder(options: readonly ComponentDescriptionOption[], kind: ComponentDescriptionOptionKind): number {
  const orders = options.filter((o) => o.kind === kind).map((o) => o.sortOrder);
  return orders.length ? Math.max(...orders) + 10 : 10;
}

/**
 * An option or type name as it's stored: trimmed, without a trailing " -".
 * The separator is added when the description is put together, so "SIL CAT 1 -"
 * typed with its dash would otherwise save as "SIL CAT 1 - - …".
 */
export function cleanOptionName(name: string): string {
  return name.trim().replace(/\s*-+\s*$/, "").trim();
}

/** Why a new or renamed option can't be saved, or null. Names are unique within their kind. */
export function optionNameProblem(
  name: string,
  kind: ComponentDescriptionOptionKind,
  options: readonly ComponentDescriptionOption[],
  exceptId?: number,
): string | null {
  const n = cleanOptionName(name);
  if (!n) return kind === "Description" ? "Type the description." : "Type the SIL category.";
  const clash = options.find((o) => o.kind === kind && o.id !== exceptId && o.name.trim().toLowerCase() === n.toLowerCase());
  return clash ? `"${clash.name}" is already on the list.` : null;
}

/** Why a new type can't be added under this description, or null. */
export function typeNameProblem(type: string, existing: readonly string[]): string | null {
  const t = cleanOptionName(type);
  if (!t) return "Type the type.";
  if (/[\r\n]/.test(t)) return "A type is one line.";
  const clash = existing.find((e) => e.toLowerCase() === t.toLowerCase());
  return clash ? `"${clash}" is already a type here.` : null;
}

/** What somebody has picked on the New part form. */
export interface DescriptionPicks {
  silCategory: string;
  name: string;
  type: string;
}

export const EMPTY_PICKS: DescriptionPicks = { silCategory: "", name: "", type: "" };

/** The text the picks save as — "SIL CAT 1 - CAPACITOR - CERAMIC". Blank picks are left out. */
export function composeDescription(picks: DescriptionPicks): string {
  return [picks.silCategory, picks.name, picks.type]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(DESCRIPTION_SEPARATOR)
    .toUpperCase();
}

/**
 * What still has to be picked before the part can be added, or null.
 *
 * `needSil` is true on the 722 list, but only while the list offers a SIL
 * category: an empty SIL list must not make every 722 part impossible to add.
 */
export function picksProblem(
  picks: DescriptionPicks,
  options: readonly ComponentDescriptionOption[],
  needSil: boolean,
): string | null {
  const sil = optionsOfKind(options, "SIL Category");
  if (needSil && sil.length > 0 && !picks.silCategory.trim()) return "Pick the SIL category.";
  if (!picks.name.trim()) return "Pick a Description.";
  const types = typesFor(options, picks.name);
  if (types.length > 0 && !picks.type.trim()) return `Pick a Type for ${picks.name}.`;
  return null;
}

/** The Types offered under a Description, or [] when it has none (or isn't on the list). */
export function typesFor(options: readonly ComponentDescriptionOption[], name: string): string[] {
  const n = name.trim().toLowerCase();
  if (!n) return [];
  return options.find((o) => o.kind === "Description" && o.name.trim().toLowerCase() === n)?.types ?? [];
}

/**
 * The picks that still make sense once the options change underneath them — a
 * restored draft, or an option renamed while the form was open. A pick the
 * list no longer offers is dropped rather than saved as text nobody chose
 * from the list.
 */
export function reconcilePicks(picks: DescriptionPicks, options: readonly ComponentDescriptionOption[]): DescriptionPicks {
  const has = (kind: ComponentDescriptionOptionKind, v: string) =>
    optionsOfKind(options, kind).find((o) => o.name.toLowerCase() === v.trim().toLowerCase())?.name ?? "";
  const silCategory = picks.silCategory ? has("SIL Category", picks.silCategory) : "";
  const name = picks.name ? has("Description", picks.name) : "";
  const type = name ? (typesFor(options, name).find((t) => t.toLowerCase() === picks.type.trim().toLowerCase()) ?? "") : "";
  return { silCategory, name, type };
}

/** The options the list is seeded with — the old app's, plus the SIL categories. */
export function seedOptions(): ComponentDescriptionOption[] {
  const descriptions = seed.descriptions.map((d, i) => ({
    id: i + 1,
    kind: "Description" as const,
    name: d.name,
    types: [...d.types],
    sortOrder: (i + 1) * 10,
  }));
  const sil = seed.silCategories.map((name, i) => ({
    id: descriptions.length + i + 1,
    kind: "SIL Category" as const,
    name,
    types: [],
    sortOrder: (i + 1) * 10,
  }));
  return [...descriptions, ...sil];
}
