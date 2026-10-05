// =============================================================================
// What Rating A, B and C MEAN for a component — they are three generic columns
// whose meaning depends on what the part is.
//
// The table is transcribed from the HCO entry rules in Thomas Terhune's 2023
// Altronic Parts List user guide (the "Component / a type / b type / c type"
// table), plus IC from the old app's form. "none" in the guide means the
// rating is unused for that component, which is carried as null here.
//
// The New Part form shows these AS the field labels ("Resistance", not
// "Rating A"), the way the old app's form did; the columns are still
// RatingA/B/C underneath.
//
// There is no component-type column, so the type is read off the start of the
// Description, which is how the data is written ("RESISTOR - FILM", "CAPACITOR
// - CERAMIC", "OBSOLETE - DIODE - ZENER"). The LONGEST matching name wins, so
// "Resistor network" beats "Resistor" and "Diode Schottky" beats "Diode".
// =============================================================================

export interface RatingLabels {
  /** The guide's component name, e.g. "Capacitor ceramic". */
  component: string;
  a: string | null;
  b: string | null;
  c: string | null;
}

export const COMPONENT_RATING_TABLE: readonly RatingLabels[] = [
  // B and C are the REVERSE of the guide, which reads B = Working voltage,
  // C = Power. The data says otherwise: of the 1,016 resistors on the live
  // Component List (2026-10-05), 872 hold power in B and voltage in C
  // ("681R / 250mW / 200V"), and only 40 the guide's way round — 37 of those
  // entered recently, following a form that used the guide's labels.
  // Labelling by the guide put "Working voltage: 250mW" on most resistors
  // (BusinessIT#18). Trimpot, below, already reads B = Power.
  { component: "Resistor", a: "Resistance", b: "Power", c: "Working voltage" },
  { component: "Capacitor ceramic", a: "Capacitance", b: "Working voltage", c: "Temp coef" },
  { component: "Capacitor electrolytic", a: "Capacitance", b: "Working voltage", c: null },
  { component: "Capacitance tantalum", a: "Capacitance", b: "Working voltage", c: null },
  { component: "Resistor network", a: "Resistance", b: "# circuits", c: "Circuit type (isolated or bussed)" },
  { component: "Capacitor network", a: "Capacitance", b: "# circuits", c: "Circuit type" },
  { component: "Diode", a: "Reverse voltage", b: "Power", c: "Max current" },
  { component: "Diode Schottky", a: "Reverse voltage", b: "Power", c: "Forward voltage" },
  { component: "Diode led", a: "Reverse voltage", b: "Forward voltage", c: "Color" },
  { component: "Transistor fet", a: "Drain source voltage", b: "Drain to source current", c: "On resistance" },
  { component: "Transistor bipolar", a: "Collector emitter voltage", b: "Drain current", c: null },
  { component: "Inductor", a: "Inductance", b: "Max current", c: "Resistance" },
  { component: "Relay", a: "Load voltage", b: "Load current", c: "Contact resistance" },
  { component: "Crystal", a: "Frequency", b: "Power", c: "Load capacitance" },
  { component: "Oscillator", a: "Frequency", b: "Operating voltage", c: "Output current" },
  // The guide's PDF read "Type (i3 lithium)"; the old app's form says Li3.
  { component: "Battery", a: "Voltage", b: "Capacity", c: "Type (Li3 lithium)" },
  { component: "Trimpot", a: "Resistance", b: "Power", c: "# of turns" },
  // Not in the guide's table — taken from the old app's Add Component form
  // (Tim, 2026-09-29), which labels an IC's ratings this way.
  { component: "IC", a: "Voltage", b: "Current", c: "Pin count" },
];

/** Used when the description names nothing in the table. */
export const GENERIC_RATING_LABELS: RatingLabels = {
  component: "",
  a: "Rating A",
  b: "Rating B",
  c: "Rating C",
};

/** Upper-case words only — "CAPACITOR - CERAMIC, 0.1UF" → "CAPACITOR CERAMIC 0 1UF". */
function words(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// The guide spells tantalum's row "Capacitance tantalum"; the data says
// "CAPACITOR - TANTALUM". Match either.
const ALIASES: Record<string, string[]> = {
  "Capacitance tantalum": ["CAPACITOR TANTALUM"],
  "Transistor fet": ["TRANSISTOR FET", "TRANSISTOR MOSFET"],
  "Diode led": ["DIODE LED", "LED"],
};

/**
 * The rating labels for a component, from its description. Falls back to the
 * generic "Rating A/B/C" rather than guessing — a wrong label is worse than a
 * plain one.
 */
export function ratingLabelsFor(description: string): RatingLabels {
  let d = words(description);
  // "OBSOLETE - IC - …" and "SIL CAT 1 - CAPACITOR - …" — neither prefix is
  // the type.
  d = d.replace(/^OBSOLETE\s+/, "").replace(/^SIL CAT \d+\s+/, "");
  let best: RatingLabels | null = null;
  let bestLen = 0;
  for (const row of COMPONENT_RATING_TABLE) {
    const names = [words(row.component), ...(ALIASES[row.component] ?? [])];
    for (const name of names) {
      if ((d === name || d.startsWith(`${name} `)) && name.length > bestLen) {
        best = row;
        bestLen = name.length;
      }
    }
  }
  return best ?? GENERIC_RATING_LABELS;
}

export type RatingKey = "ratingA" | "ratingB" | "ratingC";

const RATING_LETTERS: readonly [RatingKey, "a" | "b" | "c"][] = [
  ["ratingA", "a"],
  ["ratingB", "b"],
  ["ratingC", "c"],
];

/**
 * What each Rating column means for a SET of components, when they agree —
 * so a list narrowed to resistors can head its columns Resistance / Power /
 * Working voltage instead of Rating A/B/C (Tim, 2026-10-05). A column absent
 * from the result keeps its generic name.
 *
 * Decided per column, from the rows that HOLD a value there. A blank can't
 * contradict anything, so ceramic and electrolytic capacitors together still
 * agree on C (only the ceramics fill it in), and resistors with resistor
 * networks still agree on A (Resistance) while B and C stay generic.
 *
 * Any row whose type isn't in the table, or that holds a value in a column
 * its type says is unused, means we can't say — generic, rather than a label
 * that's wrong for some of the rows on screen.
 */
export function sharedRatingLabels(
  rows: readonly { description: string; ratingA: string; ratingB: string; ratingC: string }[],
): Partial<Record<RatingKey, string>> {
  const out: Partial<Record<RatingKey, string>> = {};
  for (const [key, letter] of RATING_LETTERS) {
    let shared: string | null | undefined;
    for (const row of rows) {
      if (!row[key].trim()) continue;
      const labels = ratingLabelsFor(row.description);
      const meaning = labels.component ? labels[letter] : null;
      if (meaning === null || (shared !== undefined && shared !== meaning)) {
        shared = null;
        break;
      }
      shared = meaning;
    }
    if (shared) out[key] = shared;
  }
  return out;
}
