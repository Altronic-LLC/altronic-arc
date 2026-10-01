import { describe, expect, it } from "vitest";
import { COMPONENT_RATING_TABLE, GENERIC_RATING_LABELS, ratingLabelsFor } from "./componentRatings";

describe("ratingLabelsFor", () => {
  it("reads a plain component type off the description", () => {
    expect(ratingLabelsFor("RESISTOR")).toMatchObject({ a: "Resistance", b: "Working voltage", c: "Power" });
    expect(ratingLabelsFor("INDUCTOR")).toMatchObject({ a: "Inductance" });
  });

  it("names an IC's ratings the way the old app's form did", () => {
    expect(ratingLabelsFor("IC - OP AMP")).toMatchObject({ a: "Voltage", b: "Current", c: "Pin count" });
    // Only the word IC — not any description starting with those letters.
    expect(ratingLabelsFor("ICE CUBE")).toBe(GENERIC_RATING_LABELS);
  });

  it("reads a battery's type as Li3 lithium", () => {
    expect(ratingLabelsFor("BATTERY").c).toBe("Type (Li3 lithium)");
  });

  it("matches a two-word type written with a dash", () => {
    expect(ratingLabelsFor("CAPACITOR - CERAMIC")).toMatchObject({
      component: "Capacitor ceramic",
      c: "Temp coef",
    });
  });

  it("prefers the LONGEST match", () => {
    expect(ratingLabelsFor("RESISTOR NETWORK").component).toBe("Resistor network");
    expect(ratingLabelsFor("DIODE - SCHOTTKY").component).toBe("Diode Schottky");
    // A zener is not in the table, so it falls back to plain Diode.
    expect(ratingLabelsFor("DIODE - ZENER").component).toBe("Diode");
  });

  it("reads a word only as a whole word", () => {
    // "RESISTORS" is not "RESISTOR" followed by anything.
    expect(ratingLabelsFor("RESISTORS")).toBe(GENERIC_RATING_LABELS);
  });

  it("ignores an OBSOLETE prefix", () => {
    expect(ratingLabelsFor("OBSOLETE - TRANSISTOR - FET - N CHANNEL").component).toBe("Transistor fet");
  });

  it("ignores a SIL CAT prefix — how 722 parts are written", () => {
    expect(ratingLabelsFor("SIL CAT 1 - CAPACITOR - CERAMIC").component).toBe("Capacitor ceramic");
    expect(ratingLabelsFor("SIL CAT 2 - RESISTOR").component).toBe("Resistor");
  });

  it("maps the guide's 'Capacitance tantalum' row to what the data says", () => {
    expect(ratingLabelsFor("CAPACITOR - TANTALUM").component).toBe("Capacitance tantalum");
  });

  it("carries the guide's 'none' as an unused rating", () => {
    expect(ratingLabelsFor("CAPACITOR - ELECTROLYTIC").c).toBeNull();
  });

  it("falls back to the generic names rather than guessing", () => {
    expect(ratingLabelsFor("TRANSFORMER - CUSTOM")).toBe(GENERIC_RATING_LABELS);
    expect(ratingLabelsFor("")).toBe(GENERIC_RATING_LABELS);
  });

  it("has every row of the guide's table, plus IC from the old app", () => {
    expect(COMPONENT_RATING_TABLE).toHaveLength(18);
  });
});
