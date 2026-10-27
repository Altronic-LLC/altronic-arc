import { describe, expect, it } from "vitest";
import {
  buildCrimpCheckTitle,
  crimpAverage,
  crimpLimits,
  crimpSpecKey,
  crimpSpecLabel,
  failingReadings,
  formatCrimp,
  gaugeLabel,
  isOutOfSpec,
  looksLikeMillimetres,
  parseCrimpReading,
  readingStatus,
  shouldAlertOutOfSpec,
  specText,
} from "./crimpCheck";
import { MOCK_CRIMP_CHECKS } from "@/data/crimpMockData";
import type { CrimpCheck } from "@/types/crimp";

describe("crimpLimits / readingStatus", () => {
  const limits = crimpLimits(0.04, 0.002)!;

  it("counts the limits themselves as in spec", () => {
    // The 610494 sheet: .038 against .040 ± .002, over and over.
    expect(readingStatus(0.038, limits)).toBe("in");
    expect(readingStatus(0.042, limits)).toBe("in");
  });

  it("calls a reading past either limit low or high", () => {
    expect(readingStatus(0.0379, limits)).toBe("low");
    expect(readingStatus(0.0421, limits)).toBe("high");
  });

  it("has no answer without a reading or without limits", () => {
    expect(readingStatus(null, limits)).toBeNull();
    expect(readingStatus(0.04, null)).toBeNull();
    expect(crimpLimits(null, 0.002)).toBeNull();
    expect(crimpLimits(0.04, null)).toBeNull();
    expect(crimpLimits(0.04, -0.001)).toBeNull();
  });
});

describe("isOutOfSpec / failingReadings", () => {
  const limits = crimpLimits(0.042, 0.002);

  it("is out when ANY single reading is out, even if the average is in", () => {
    // Average 0.043 is in spec; reading 2 isn't.
    expect(crimpAverage([0.042, 0.045, 0.043])).toBeCloseTo(0.04333, 5);
    expect(isOutOfSpec([0.042, 0.045, 0.043], limits)).toBe(true);
    expect(failingReadings([0.042, 0.045, 0.043], limits)).toEqual([{ position: 2, value: 0.045, status: "high" }]);
  });

  it("is never out when the spec has no crimp height", () => {
    expect(isOutOfSpec([1, 2, 3], null)).toBe(false);
  });
});

describe("crimpAverage", () => {
  it("averages what is there, to 5 decimals", () => {
    expect(crimpAverage([0.038, 0.039, 0.039])).toBe(0.03867);
    expect(crimpAverage([0.04, null, null])).toBe(0.04);
    expect(crimpAverage([null, null, null])).toBeNull();
  });
});

describe("parseCrimpReading", () => {
  it("reads what the micrometer and the floor write", () => {
    expect(parseCrimpReading(".039")).toBe(0.039);
    expect(parseCrimpReading(" 0.0390 ")).toBe(0.039);
    expect(parseCrimpReading('0.040"')).toBe(0.04);
    expect(parseCrimpReading("0.040 in")).toBe(0.04);
  });

  it("refuses anything it can't read, rather than saving zero", () => {
    expect(parseCrimpReading("")).toBeNull();
    expect(parseCrimpReading("-0.04")).toBeNull();
    expect(parseCrimpReading("abc")).toBeNull();
    expect(parseCrimpReading("0.04.1")).toBeNull();
  });
});

describe("looksLikeMillimetres", () => {
  it("flags a reading ten times the nominal or more", () => {
    expect(looksLikeMillimetres(0.99, 0.039)).toBe(true);
    expect(looksLikeMillimetres(0.045, 0.039)).toBe(false);
  });

  it("falls back to half an inch with no nominal", () => {
    expect(looksLikeMillimetres(1.02, null)).toBe(true);
    expect(looksLikeMillimetres(0.09, null)).toBe(false);
    expect(looksLikeMillimetres(null, 0.04)).toBe(false);
  });
});

describe("shouldAlertOutOfSpec", () => {
  const inSpec = MOCK_CRIMP_CHECKS.find((c) => !c.outOfSpec)!;
  const out: CrimpCheck = { ...inSpec, outOfSpec: true };

  it("alerts on a new out-of-spec check, and not on an in-spec one", () => {
    expect(shouldAlertOutOfSpec(null, out)).toBe(true);
    expect(shouldAlertOutOfSpec(null, inSpec)).toBe(false);
  });

  it("alerts on an edit only when the check BECOMES out of spec", () => {
    expect(shouldAlertOutOfSpec(inSpec, out)).toBe(true);
    // Fixing a typo in the harness number on a check that was already out.
    expect(shouldAlertOutOfSpec(out, { ...out, harnessOrAssembly: "fixed" })).toBe(false);
  });
});

describe("labels", () => {
  it("formats crimp heights to 3 decimals, 4 when it matters", () => {
    expect(formatCrimp(0.039)).toBe("0.039");
    expect(formatCrimp(0.03867)).toBe("0.0387");
    expect(formatCrimp(0.002)).toBe("0.002");
    expect(formatCrimp(null)).toBe("—");
  });

  it("writes a spec, or says there isn't one", () => {
    expect(specText(0.04, 0.002)).toBe("0.040 ± 0.002");
    expect(specText(null, null)).toBe("No crimp height");
  });

  it("adds AWG to a bare gauge only", () => {
    expect(gaugeLabel("18")).toBe("18 AWG");
    expect(gaugeLabel("0.5 mm² or 20")).toBe("0.5 mm² or 20");
    expect(gaugeLabel(" ")).toBe("");
  });

  it("builds the picker label and the check title", () => {
    expect(crimpSpecLabel({ terminal: "900101", wireGauge: "14", applicator: "A1001" })).toBe("900101 · 14 AWG · A1001");
    expect(buildCrimpCheckTitle("900101", "14", "Start")).toBe("900101 / 14 AWG / Start");
    expect(buildCrimpCheckTitle("", "", null)).toBe("(untitled check)");
  });

  it("keys a spec on terminal + applicator + gauge, ignoring case and spacing", () => {
    expect(crimpSpecKey({ terminal: " 900101", wireGauge: "14", applicator: "a1001" })).toBe(
      crimpSpecKey({ terminal: "900101", wireGauge: "14 ", applicator: "A1001" }),
    );
    expect(crimpSpecKey({ terminal: "900101", wireGauge: "16", applicator: "A1001" })).not.toBe(
      crimpSpecKey({ terminal: "900101", wireGauge: "14", applicator: "A1001" }),
    );
  });
});
