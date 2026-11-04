import { describe, expect, it } from "vitest";
import {
  buildCoatingCheckTitle,
  byFrequency,
  coatingAverage,
  coatingLimits,
  coatingResult,
  coatingSpecMilsText,
  coatingSpecText,
  coatingThicknessMm,
  formatCoatingReading,
  formatIn,
  formatMm,
  isCoatingOutOfSpec,
  looksLikeOtherUnit,
  mergeSuggestions,
  shortListSuggestions,
  mmToMils,
  parseCoatingReading,
  shouldAlertCoatingOutOfSpec,
  thicknessStatus,
  thicknessText,
  toMm,
  coatingSpecRefText,
} from "./coatingCheck";
import { MOCK_COATING_CHECKS } from "@/data/coatingMockData";

// =============================================================================
// The conformal coating maths (BusinessIT#60): the thickness is worked out in
// mm and JUDGED IN THE SPEC'S UNIT — mm or inches, whatever the readings were
// taken in. Mils are reference only (Tim, 2026-11-04).
// =============================================================================

describe("coatingAverage", () => {
  it("averages three readings", () => {
    expect(coatingAverage([1.575, 1.577, 1.576])).toBe(1.576);
  });

  it("is null unless all three are there — the procedure is three of each", () => {
    expect(coatingAverage([1.5, null, 1.6])).toBeNull();
    expect(coatingAverage([null, null, null])).toBeNull();
  });
});

describe("coatingThicknessMm", () => {
  it("is the difference of the averages, in mm, for a millimetre check", () => {
    // 1.641 − 1.576 = 0.065 mm, one side.
    expect(coatingThicknessMm([1.575, 1.577, 1.576], [1.64, 1.642, 1.641], "mm", 1)).toBe(0.065);
  });

  it("halves it when both sides are coated", () => {
    expect(coatingThicknessMm([1.575, 1.577, 1.576], [1.64, 1.642, 1.641], "mm", 2)).toBe(0.0325);
  });

  it("converts inch readings to mm before anything is judged", () => {
    // 0.0661 − 0.0621 = 0.004 in = 0.1016 mm; both sides → 0.0508 mm.
    expect(coatingThicknessMm([0.062, 0.0622, 0.0621], [0.0661, 0.0662, 0.066], "in", 2)).toBe(0.0508);
  });

  it("is negative when the coated board measured thinner, rather than hiding the mistake", () => {
    expect(coatingThicknessMm([1.6, 1.6, 1.6], [1.59, 1.59, 1.59], "mm", 1)).toBe(-0.01);
  });

  it("is null while either side is incomplete", () => {
    expect(coatingThicknessMm([1.6, 1.6, null], [1.7, 1.7, 1.7], "mm", 1)).toBeNull();
  });
});

describe("mils are reference only", () => {
  it("converts mm to mils to two decimals", () => {
    expect(mmToMils(0.0508)).toBe(2);
    expect(mmToMils(0.025)).toBe(0.98);
    expect(mmToMils(null)).toBeNull();
  });

  it("is never what decides the result — a thickness just past the mm limit is out however the mils round", () => {
    // 0.0751 mm is 2.96 mils; the 0.075 mm limit is 2.95 mils. Judged in mm.
    expect(thicknessStatus(0.0751, coatingLimits(0.025, 0.075))).toBe("high");
    expect(thicknessText(0.0751)).toBe("0.0751 mm (0.00296 in · 2.96 mils)");
  });
});

describe("judging against the spec", () => {
  const limits = coatingLimits(0.025, 0.075);

  it("counts the limits themselves as in spec", () => {
    expect(thicknessStatus(0.025, limits)).toBe("in");
    expect(thicknessStatus(0.075, limits)).toBe("in");
  });

  it("calls anything outside low or high", () => {
    expect(thicknessStatus(0.0249, limits)).toBe("low");
    expect(thicknessStatus(0.0751, limits)).toBe("high");
    expect(isCoatingOutOfSpec(0.0249, limits)).toBe(true);
    expect(isCoatingOutOfSpec(0.05, limits)).toBe(false);
  });

  it("can't judge without limits, or with them backwards", () => {
    expect(coatingLimits(null, 0.075)).toBeNull();
    expect(coatingLimits(0.08, 0.075)).toBeNull();
    expect(thicknessStatus(0.05, null)).toBeNull();
    expect(isCoatingOutOfSpec(0.05, null)).toBe(false);
  });

  it("labels the result in words", () => {
    expect(coatingResult({ outOfSpec: true, minMm: 0.025, maxMm: 0.075, thicknessMm: 0.09 })).toBe("Out of spec");
    expect(coatingResult({ outOfSpec: false, minMm: 0.025, maxMm: 0.075, thicknessMm: 0.05 })).toBe("In spec");
    expect(coatingResult({ outOfSpec: false, minMm: null, maxMm: null, thicknessMm: 0.05 })).toBe("Not judged");
  });
});

describe("a spec entered in inches", () => {
  // 0.002 – 0.003 in (X.XXX), stored in mm at full precision.
  const limits = coatingLimits(toMm(0.002, "in"), toMm(0.003, "in"), "in");

  it("gives back exactly the inches that were typed", () => {
    expect(limits).toEqual({ min: 0.002, max: 0.003, unit: "in" });
  });

  it("judges in inches, the limits counting as in spec", () => {
    // 0.0662 − 0.0622 = 0.004 in across both faces = 0.002 in a side: the limit.
    const mm = coatingThicknessMm([0.0622, 0.0622, 0.0622], [0.0662, 0.0662, 0.0662], "in", 2);
    expect(thicknessStatus(mm, limits)).toBe("in");
    expect(thicknessStatus(toMm(0.00199, "in"), limits)).toBe("low");
    expect(thicknessStatus(toMm(0.00301, "in"), limits)).toBe("high");
  });

  it("judges readings taken in mm against it too", () => {
    // 1.641 − 1.576 = 0.065 mm one side = 0.00256 in — inside 0.002 – 0.003.
    const mm = coatingThicknessMm([1.575, 1.577, 1.576], [1.64, 1.642, 1.641], "mm", 1);
    expect(thicknessStatus(mm, limits)).toBe("in");
    expect(thicknessText(mm, "in")).toBe("0.00256 in (0.065 mm · 2.56 mils)");
  });

  it("shows its limits in inches as X.XXX first, then mm and mils for reference", () => {
    expect(coatingSpecText(toMm(0.001, "in"), toMm(0.003, "in"), "in")).toBe("0.001 – 0.003 in");
    expect(coatingSpecRefText(toMm(0.001, "in"), toMm(0.003, "in"), "in")).toBe("0.0254 – 0.0762 mm · 1.00 – 3.00 mils");
  });
});

describe("readings", () => {
  it("reads what a micrometer or a person types", () => {
    expect(parseCoatingReading("1.588")).toBe(1.588);
    expect(parseCoatingReading(" .0625 ")).toBe(0.0625);
    expect(parseCoatingReading('0.0625"')).toBe(0.0625);
    expect(parseCoatingReading("1.588 mm")).toBe(1.588);
  });

  it("refuses what isn't a reading rather than saving it as zero", () => {
    expect(parseCoatingReading("abc")).toBeNull();
    expect(parseCoatingReading("-1.5")).toBeNull();
    expect(parseCoatingReading("")).toBeNull();
  });

  it("spots a reading in the other unit", () => {
    expect(looksLikeOtherUnit(0.062, "mm")).toBe("in");
    expect(looksLikeOtherUnit(1.588, "in")).toBe("mm");
    expect(looksLikeOtherUnit(1.588, "mm")).toBeNull();
    expect(looksLikeOtherUnit(0.0625, "in")).toBeNull();
  });
});

describe("shouldAlertCoatingOutOfSpec", () => {
  const out = MOCK_COATING_CHECKS.find((c) => c.outOfSpec)!;
  const ok = MOCK_COATING_CHECKS.find((c) => !c.outOfSpec)!;

  it("alerts on a new out-of-spec check", () => {
    expect(shouldAlertCoatingOutOfSpec(null, out)).toBe(true);
  });

  it("doesn't alert on an in-spec check", () => {
    expect(shouldAlertCoatingOutOfSpec(null, ok)).toBe(false);
  });

  it("doesn't alert again when an already-out check is re-saved", () => {
    expect(shouldAlertCoatingOutOfSpec(out, { ...out, notes: "typo" })).toBe(false);
  });

  it("alerts when an edit turns a check out of spec", () => {
    expect(shouldAlertCoatingOutOfSpec(ok, { ...ok, outOfSpec: true })).toBe(true);
  });
});

describe("labels", () => {
  it("formats mm to 3 decimals, a 4th only when it means something", () => {
    expect(formatMm(0.025)).toBe("0.025");
    expect(formatMm(0.0254)).toBe("0.0254");
    expect(formatMm(null)).toBe("—");
  });

  it("formats readings in their own unit", () => {
    expect(formatCoatingReading(1.5, "mm")).toBe("1.500");
    expect(formatCoatingReading(0.062, "in")).toBe("0.0620");
  });

  it("formats inches to 4 decimals, a 5th only when it means something", () => {
    expect(formatIn(0.001)).toBe("0.0010");
    expect(formatIn(0.00098)).toBe("0.00098");
  });

  it("describes the spec in mm, with mils for reference", () => {
    expect(coatingSpecText(0.025, 0.075)).toBe("0.025 – 0.075 mm");
    expect(coatingSpecMilsText(0.025, 0.075)).toBe("0.98 – 2.95 mils");
    expect(coatingSpecText(null, null)).toBe("No limits set");
    expect(coatingSpecMilsText(null, null)).toBe("");
  });

  it("titles a check by machine, spec and LOCAL date", () => {
    expect(buildCoatingCheckTitle(" SPRAY-1 ", "Acrylic", new Date(2026, 10, 4, 23, 30))).toBe("SPRAY-1 / Acrylic / 2026-11-04");
    expect(buildCoatingCheckTitle("", "", null)).toBe("(untitled check)");
  });

  it("orders suggestions most-used first", () => {
    expect(byFrequency(["B", "A", "B", " ", "C", "A", "B"])).toEqual(["B", "A", "C"]);
  });

  it("opens on the whole register until a check uses a machine, then on the short list", () => {
    expect(shortListSuggestions([], ["OVEN 3", "SPRAY-1"])).toEqual({ options: ["OVEN 3", "SPRAY-1"], search: [] });
    // After a check: the short list, with the register searched only when typing.
    expect(shortListSuggestions(["SPRAY-1"], ["OVEN 3", "SPRAY-1"])).toEqual({
      options: ["SPRAY-1"],
      search: ["OVEN 3", "SPRAY-1"],
    });
  });

  it("puts what earlier checks used before the register, without repeats", () => {
    expect(mergeSuggestions(["SPRAY-2", "spray-1"], ["Spray-1", "OVEN 3", " ", "SPRAY-2"])).toEqual([
      "SPRAY-2",
      "spray-1",
      "OVEN 3",
    ]);
    // A brand-new log: the register alone.
    expect(mergeSuggestions([], ["OVEN 3"])).toEqual(["OVEN 3"]);
  });
});
