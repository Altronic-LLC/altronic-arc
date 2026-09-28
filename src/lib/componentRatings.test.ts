import { describe, expect, it } from "vitest";
import { COMPONENT_RATING_TABLE, GENERIC_RATING_LABELS, ratingLabelsFor } from "./componentRatings";

describe("ratingLabelsFor", () => {
  it("reads a plain component type off the description", () => {
    expect(ratingLabelsFor("RESISTOR")).toMatchObject({ a: "Resistance", b: "Working voltage", c: "Power" });
    expect(ratingLabelsFor("INDUCTOR")).toMatchObject({ a: "Inductance" });
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

  it("maps the guide's 'Capacitance tantalum' row to what the data says", () => {
    expect(ratingLabelsFor("CAPACITOR - TANTALUM").component).toBe("Capacitance tantalum");
  });

  it("carries the guide's 'none' as an unused rating", () => {
    expect(ratingLabelsFor("CAPACITOR - ELECTROLYTIC").c).toBeNull();
  });

  it("falls back to the generic names rather than guessing", () => {
    expect(ratingLabelsFor("IC - MICROCONTROLLER")).toBe(GENERIC_RATING_LABELS);
    expect(ratingLabelsFor("")).toBe(GENERIC_RATING_LABELS);
  });

  it("has every row of the guide's table", () => {
    expect(COMPONENT_RATING_TABLE).toHaveLength(17);
  });
});
