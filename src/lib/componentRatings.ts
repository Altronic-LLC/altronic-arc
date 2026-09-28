// =============================================================================
// What Rating A, B and C MEAN for a component — they are three generic columns
// whose meaning depends on what the part is.
//
// The table is transcribed verbatim from the HCO entry rules in Thomas
// Terhune's 2023 Altronic Parts List user guide (the "Component / a type /
// b type / c type" table). "none" in the guide means the rating is unused for
// that component, which is carried as null here.
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
  { component: "Resistor", a: "Resistance", b: "Working voltage", c: "Power" },
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
  { component: "Battery", a: "Voltage", b: "Capacity", c: "Type (i3 lithium)" },
  { component: "Trimpot", a: "Resistance", b: "Power", c: "# of turns" },
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
  // "OBSOLETE - IC - …" — the status prefix is not the type.
  d = d.replace(/^OBSOLETE\s+/, "");
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
