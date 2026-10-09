import { isComponentPrefix } from "./altronicPartMapper";

// =============================================================================
// What a part number's digits MEAN — EWI-005 Rev 5 (Component/Document Part
// Number Guidelines, 2025-09-26), §3.9 "ABC XXX-YZ". Drives the Parts Book and
// list labels (Tim, 2026-10-09). Pure, and the ONE copy of these tables.
//
//   A = product code     → the Parts Book (first digit)
//   B = assembly level   ┐ together with A, the three-digit
//   C = device type      ┘ "parts list" (partPrefix)
//
// Each entry carries the EWI's wording verbatim (`full`, for tooltips and the
// list page) and a short form that fits a tile (`short`).
//
// Three things that are deliberate:
//
//  - The HCO component lists (601/611/701/711/712/722) are NOT labelled from
//    here — they keep Through Hole / Surface Mount / SIL, which is what people
//    call them. `listMeaning` returns null for them.
//  - An UNUSED device type (C = 5, 7, 8) is never shown as "Unused" on a tile.
//    Legacy lists like 915 hold real parts the guideline postdates, and a tile
//    reading "Unused" over hundreds of parts reads as wrong. The tile shows the
//    assembly level alone; the tooltip says the type isn't assigned.
//  - The 800 book is "Special Products" — Altronic's name, not the EWI's
//    (which lists 8 as unused). Its tooltips say so.
//  - Rev 5 gives B = 0 and B = 3 the SAME meaning ("Electrical/Electronic
//    Components or Hardware"). Transcribed as written — don't "fix" one of them
//    without the document changing first.
//
// These describe what a number means UNDER THE GUIDELINE. Legacy numbers
// predate it, so a list's parts may not all match its label.
// =============================================================================

export const EWI_005 = "EWI-005 Rev 5";

interface DigitMeaning {
  /** The EWI's own wording. */
  full: string;
  /** Short enough for a tile. */
  short: string;
  /** "Unused" in the EWI — never shown as a label. */
  unused?: boolean;
}

/** A — the product code, i.e. the Parts Book. */
export const PRODUCT_CODES: Readonly<Record<number, DigitMeaning>> = {
  1: { full: "Altronic I Ignition System", short: "Altronic I Ignition" },
  2: { full: "Altronic II Ignition System", short: "Altronic II Ignition" },
  3: { full: "Altronic III Ignition System", short: "Altronic III Ignition" },
  4: { full: "Altronic IV Ignition System", short: "Altronic IV Ignition" },
  5: { full: "Altronic V or Multiple Ignition Systems", short: "Altronic V / Multiple Ignition" },
  6: { full: "Instrumentation or Control Systems", short: "Instrumentation & Control" },
  7: { full: "DC Powered Digital Ignition Systems", short: "DC Digital Ignition" },
  // EWI-005 lists 8 as unused; "Special Products" is Altronic's own name for
  // the book (Tim, 2026-10-09), and every tooltip says it isn't the EWI's.
  8: { full: "Unused", short: "Special Products", unused: true },
  9: { full: "Fasteners and Hardware", short: "Fasteners & Hardware" },
};

/** B — the assembly level. */
export const ASSEMBLY_LEVELS: Readonly<Record<number, DigitMeaning>> = {
  0: { full: "Electrical/Electronic Components or Hardware", short: "Components / Hardware" },
  1: { full: "Mechanical or Electromechanical parts", short: "Mechanical" },
  2: { full: "Sub-assembly using level 0 or 1 components", short: "Sub-assy (level 0–1 parts)" },
  3: { full: "Electrical/Electronic Components or Hardware", short: "Components / Hardware" },
  4: { full: "Sub-assembly below level 5", short: "Sub-assy below level 5" },
  5: { full: "Sub-assembly below level 6", short: "Sub-assy below level 6" },
  6: { full: "Sub-assembly below level 7", short: "Sub-assy below level 7" },
  7: { full: "Sub-assembly below level 8, typically PCB assembly", short: "PCB assembly" },
  8: { full: "Sub-assembly below level 9, typically level 7 plus others", short: "Sub-assy below level 9" },
  9: { full: "Final Assembly", short: "Final Assembly" },
};

/** C — the device type. */
export const DEVICE_TYPES: Readonly<Record<number, DigitMeaning>> = {
  0: { full: "Mechanical Part/Assembly", short: "Mechanical" },
  1: { full: "Electrical Part/Assembly, Fasteners or Hardware", short: "Electrical / Fasteners" },
  2: { full: "Circuit Board, Label, Insulator, Boot, etc.", short: "Board / Label / Insulator" },
  3: { full: "Wire, Tubing, Brackets, Adhesives, etc.", short: "Wire / Tubing / Brackets" },
  4: { full: "Connectors, Terminals", short: "Connectors / Terminals" },
  5: { full: "Unused", short: "Unused", unused: true },
  6: { full: "Tool or Fixture", short: "Tool / Fixture" },
  7: { full: "Unused", short: "Unused", unused: true },
  8: { full: "Unused", short: "Unused", unused: true },
  9: { full: "Wire Diagram, Sales Drawing, etc.", short: "Wire Diagram / Sales Drawing" },
};

/** A Parts Book's short name ("Altronic III Ignition"), or null for a non-book. */
export function partsBookLabel(book: number): string | null {
  return PRODUCT_CODES[book]?.short ?? null;
}

/**
 * A Parts Book's meaning in the EWI's words ("Altronic III Ignition System"),
 * or null. A book the EWI leaves unused gives its own name and says so.
 */
export function partsBookFullLabel(book: number): string | null {
  const code = PRODUCT_CODES[book];
  if (!code) return null;
  return code.unused ? `${code.short} (unused in EWI-005)` : code.full;
}

/** The book tile's tooltip. */
export function partsBookTooltip(book: number): string {
  const code = PRODUCT_CODES[book];
  if (!code) return `${book}00 Parts Book`;
  return code.unused
    ? `${book}00 Parts Book — ${code.short} (${EWI_005} lists ${book} as unused)`
    : `${book}00 Parts Book — ${code.full} (${EWI_005})`;
}

/**
 * Is this a DRAWING number — device type 9, "Wire Diagram, Sales Drawing,
 * etc." (the third digit)? A drawing has no datasheet, so the New Part form
 * doesn't require one for it (Tim, 2026-10-09). Takes a part number or a
 * three-digit list; the HCO component lists are never drawings.
 */
export function isDrawingNumber(partNumberOrPrefix: string): boolean {
  const m = /^(\d{3})/.exec(partNumberOrPrefix.trim());
  return !!m && !isComponentPrefix(m[1]) && m[1][2] === "9";
}

export interface ListMeaning {
  /** Tile lines, in order — the assembly level, then the device type (if any). */
  lines: string[];
  /** One line for a heading: the tile lines joined. */
  summary: string;
  /** Every digit in the EWI's words, for a tooltip. */
  description: string;
}

/**
 * What a three-digit Part List prefix means. Null for anything that isn't
 * three digits, and for the HCO component lists, which keep their own names.
 */
export function listMeaning(prefix: string): ListMeaning | null {
  if (!/^\d{3}$/.test(prefix) || isComponentPrefix(prefix)) return null;
  const product = PRODUCT_CODES[Number(prefix[0])];
  const level = ASSEMBLY_LEVELS[Number(prefix[1])];
  const type = DEVICE_TYPES[Number(prefix[2])];
  if (!product) return null; // a 0xx prefix — "0 = not used" as a product code

  const lines = [level.short];
  // Said once when both halves say the same thing (410: "Mechanical").
  if (!type.unused && type.short !== level.short) lines.push(type.short);

  const description = [
    `${prefix[0]} = ${partsBookFullLabel(Number(prefix[0]))}`,
    `${prefix[1]} = ${level.full}`,
    `${prefix[2]} = ${type.unused ? "device type not assigned in EWI-005" : type.full}`,
  ].join(" · ");

  return { lines, summary: lines.join(" · "), description: `${EWI_005}: ${description}` };
}
