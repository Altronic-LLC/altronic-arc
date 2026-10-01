import { describe, expect, it } from "vitest";
import {
  formatEngineeringValue,
  parseBound,
  parseEngineeringValue,
  rangeBounds,
  valueInRange,
} from "./engineeringValue";

// Every input here is a spelling found in the live Component List (2026-09-28).

function read(raw: string) {
  const v = parseEngineeringValue(raw);
  return v && { min: Number(v.min.toPrecision(10)), max: Number(v.max.toPrecision(10)), unit: v.unit };
}

describe("parseEngineeringValue", () => {
  it.each([
    ["4K7", 4700, "Ω"],
    ["1K0", 1000, "Ω"],
    ["100R0", 100, "Ω"],
    ["0R0", 0, "Ω"],
    ["10K0", 10_000, "Ω"],
    ["2u2", 2.2e-6, null],
    ["5V1", 5.1, "V"],
    ["R04", 0.04, "Ω"],
    ["R330", 0.33, "Ω"],
  ])("reads the RKM code %s", (raw, value, unit) => {
    expect(read(raw)).toEqual({ min: value, max: value, unit });
  });

  it("reads 4M1 as 4.1 MΩ — the old app read it as 4", () => {
    expect(read("4M1")).toEqual({ min: 4_100_000, max: 4_100_000, unit: "Ω" });
  });

  it.each([
    [".1uF", 1e-7, "F"],
    ["4.7uF", 4.7e-6, "F"],
    ["100pF", 1e-10, "F"],
    ["10uH", 1e-5, "H"],
    ["250mW", 0.25, "W"],
    ["40uA", 4e-5, "A"],
    ["20MHz", 2e7, "Hz"],
    ["100V", 100, "V"],
    ["1 uf", 1e-6, "F"],
    ["3 ma", 0.003, "A"],
    ["12VDC", 12, "V"],
  ])("reads %s with its prefix and unit", (raw, value, unit) => {
    expect(read(raw)).toEqual({ min: value, max: value, unit });
  });

  it("keeps m (milli) and M (mega) apart", () => {
    expect(read("5mA")?.min).toBe(0.005);
    expect(read("5MHz")?.min).toBe(5e6);
  });

  it("reads a bare prefix as a multiplier: 1K, 10K", () => {
    expect(read("1K")).toEqual({ min: 1000, max: 1000, unit: null });
    expect(read("10K")).toEqual({ min: 10_000, max: 10_000, unit: null });
  });

  it("reads fractions", () => {
    expect(read("1/4W")).toEqual({ min: 0.25, max: 0.25, unit: "W" });
    expect(read("1/16W")?.min).toBe(0.0625);
  });

  it("reads a value that is itself a range", () => {
    expect(read("4.5V TO 5.5V")).toEqual({ min: 4.5, max: 5.5, unit: "V" });
    expect(read("VCC = 2.5 to 6.0V")).toEqual({ min: 2.5, max: 6, unit: "V" });
  });

  it("skips a label and takes the leading value", () => {
    expect(read("Max overload voltage: 100V")).toEqual({ min: 100, max: 100, unit: "V" });
    expect(read("100mW @ 70°C, 50V.")).toEqual({ min: 0.1, max: 0.1, unit: "W" });
    expect(read("±1%, T.C.R. ±100 ppm/K.")).toEqual({ min: 1, max: 1, unit: "%" });
    expect(read("+50%/-10%")?.min).toBe(50);
    expect(read("+/-10%")?.min).toBe(10);
  });

  it.each([
    ["-55°C", -55],
    ["-55C", -55],
    ["-55C°C", -55],
    ["+125°C", 125],
    ["-40°", -40],
    ["155C", 155],
  ])("reads the temperature %s", (raw, value) => {
    expect(read(raw)).toEqual({ min: value, max: value, unit: "°C" });
  });

  it("converts °F", () => {
    expect(read("-40°F")).toEqual({ min: -40, max: -40, unit: "°C" });
  });

  it("keeps a counted word as the unit, singular", () => {
    expect(read("8 PINS")).toEqual({ min: 8, max: 8, unit: "pin" });
    expect(read("8 PIN")?.unit).toBe("pin");
    expect(read("12 TURNS")?.unit).toBe("turn");
  });

  it("doesn't read ppm as pico, or POS as a prefix", () => {
    expect(read("100 ppm")).toEqual({ min: 100, max: 100, unit: "ppm" });
    expect(read("1 POS")).toEqual({ min: 1, max: 1, unit: "pos" });
  });

  it.each(["X7R", "COG", "SEE DATA SHEET", "N/A", "CONTACT MFG", "SEE 701473", "GREEN", "not applicable°C", "", "  "])(
    "finds no number in %j",
    (raw) => {
      expect(parseEngineeringValue(raw)).toBeNull();
    },
  );
});

describe("valueInRange", () => {
  const range = (from: string, to: string) => rangeBounds(from, to);

  it("finds 4K7 in a 1K–10K search", () => {
    expect(valueInRange("4K7", range("1K", "10K"))).toBe(true);
    expect(valueInRange("22K", range("1K", "10K"))).toBe(false);
  });

  it("is inclusive at both ends, across spellings", () => {
    expect(valueInRange(".1uF", range("100nF", "1uF"))).toBe(true);
    expect(valueInRange("1uF", range("100nF", "1uF"))).toBe(true);
  });

  it("matches a stored range that overlaps the search", () => {
    expect(valueInRange("4.5V TO 5.5V", range("5V", "5V"))).toBe(true);
    expect(valueInRange("4.5V TO 5.5V", range("12V", "24V"))).toBe(false);
  });

  it("takes an open-ended search from one box", () => {
    expect(valueInRange("125°C", range("100", ""))).toBe(true);
    expect(valueInRange("85°C", range("100", ""))).toBe(false);
    expect(valueInRange("-55°C", range("", "-40"))).toBe(true);
  });

  it("requires units to agree only when both sides name one", () => {
    expect(valueInRange("10mA", range("5V", "12V"))).toBe(false);
    expect(valueInRange("8 PINS", range("5V", "12V"))).toBe(false);
    expect(valueInRange("10V", range("5", "12"))).toBe(true);
    expect(valueInRange("-55", range("-60°C", "0°C"))).toBe(true);
  });

  it("never matches a value with no number in it", () => {
    expect(valueInRange("SEE DATA SHEET", range("", "1000000"))).toBe(false);
    expect(valueInRange("", range("0", ""))).toBe(false);
  });

  it("swaps bounds typed the wrong way round", () => {
    expect(valueInRange("4K7", range("10K", "1K"))).toBe(true);
  });
});

describe("rangeBounds / parseBound", () => {
  it("is inactive with nothing readable typed", () => {
    expect(rangeBounds("", "").active).toBe(false);
    expect(rangeBounds("abc", "").active).toBe(false);
  });

  it("flags a box that holds no number", () => {
    expect(parseBound("abc", "from")).toEqual({ value: null, unit: null, unreadable: true });
    expect(parseBound("", "from").unreadable).toBe(false);
  });

  it("takes the near end of a range typed into one box", () => {
    expect(parseBound("1K TO 10K", "from").value).toBe(1000);
    expect(parseBound("1K TO 10K", "to").value).toBe(10_000);
  });
});

describe("formatEngineeringValue", () => {
  it.each([
    [4700, "Ω", "4.7 kΩ"],
    [1e-7, "F", "100 nF"],
    [0.25, "W", "250 mW"],
    [4_099_999.9999999995, "Ω", "4.1 MΩ"],
    [1000, null, "1k"],
    [-55, "°C", "-55 °C"],
    [1, "%", "1%"],
    [8, "pin", "8 pin"],
    [0, "V", "0 V"],
  ])("shows %s %s as %s", (value, unit, text) => {
    expect(formatEngineeringValue(value, unit)).toBe(text);
  });
});
