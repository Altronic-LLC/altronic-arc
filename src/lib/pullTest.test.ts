import { describe, expect, it } from "vitest";
import {
  buildPullTestTitle,
  convertForce,
  failingPulls,
  FAILURE_MODE_SHORT_LIST,
  failureModeSuggestions,
  STANDARD_FAILURE_MODES,
  formatForce,
  isPullTestFailed,
  lowestPull,
  minimumShort,
  minimumText,
  parseForceInput,
  pullResult,
  pullSpecKey,
  pullSpecLabel,
  pullStatus,
  readingSourceOf,
  shouldAlertPullFailed,
} from "./pullTest";
import { MOCK_PULL_TESTS } from "@/data/pullTestMockData";

describe("convertForce", () => {
  it("converts between the tester's units", () => {
    expect(convertForce(1, "lbF", "N")).toBeCloseTo(4.4482216, 6);
    expect(convertForce(1, "kgF", "N")).toBeCloseTo(9.80665, 6);
    expect(convertForce(16, "ozF", "lbF")).toBeCloseTo(1, 9);
    expect(convertForce(1, "kN", "N")).toBe(1000);
    expect(convertForce(12.3, "lbF", "lbF")).toBe(12.3);
  });
});

describe("pullStatus", () => {
  it("passes a pull AT the minimum — the minimum is included", () => {
    expect(pullStatus(20, "lbF", 20, "lbF")).toBe("pass");
    expect(pullStatus(19.9, "lbF", 20, "lbF")).toBe("low");
  });

  it("judges in the spec's unit, so a reading in N is converted first", () => {
    // 20 lbF = 88.964 N. 89 N holds; 88.9 N doesn't.
    expect(pullStatus(89, "N", 20, "lbF")).toBe("pass");
    expect(pullStatus(88.9, "N", 20, "lbF")).toBe("low");
  });

  it("doesn't fail a pull that converts back to exactly the minimum", () => {
    // 20 lbF → N → lbF must not come out at 19.99999999.
    expect(pullStatus(convertForce(20, "lbF", "N"), "N", 20, "lbF")).toBe("pass");
  });

  it("can't judge without a pull or a minimum", () => {
    expect(pullStatus(null, "lbF", 20, "lbF")).toBeNull();
    expect(pullStatus(25, "lbF", null, "lbF")).toBeNull();
  });
});

describe("failingPulls / isPullTestFailed", () => {
  const spec = { minimumForce: 15, specUnit: "lbF" as const };

  it("fails a test on ANY single pull below the minimum, never an average", () => {
    const readings = [30, 14.9, 30, null, null];
    expect(failingPulls(readings, "lbF", spec)).toEqual([{ position: 2, value: 14.9 }]);
    expect(isPullTestFailed(readings, "lbF", spec)).toBe(true);
  });

  it("passes when every pull that's there holds", () => {
    expect(isPullTestFailed([15, 16, 17, null, null], "lbF", spec)).toBe(false);
  });

  it("never fails a test that can't be judged", () => {
    expect(isPullTestFailed([1, 2, 3], "lbF", { minimumForce: null, specUnit: "lbF" })).toBe(false);
  });
});

describe("lowestPull", () => {
  it("is the weakest pull, skipping blanks", () => {
    expect(lowestPull([31.2, null, 29.7, null, 30])).toBe(29.7);
    expect(lowestPull([null, null])).toBeNull();
  });
});

describe("shouldAlertPullFailed", () => {
  const failed = MOCK_PULL_TESTS.find((t) => t.failed)!;
  const passed = MOCK_PULL_TESTS.find((t) => !t.failed && t.minimumForce !== null)!;

  it("alerts on a new failed test, and on an edit that makes one fail", () => {
    expect(shouldAlertPullFailed(null, failed)).toBe(true);
    expect(shouldAlertPullFailed(passed, { ...passed, failed: true })).toBe(true);
  });

  it("doesn't alert again when a failed test is re-saved, or for a pass", () => {
    expect(shouldAlertPullFailed(failed, failed)).toBe(false);
    expect(shouldAlertPullFailed(null, passed)).toBe(false);
  });
});

describe("readingSourceOf", () => {
  it("says where the pulls came from", () => {
    expect(readingSourceOf([true, true, true])).toBe("Tester");
    expect(readingSourceOf([false, false])).toBe("Typed");
    expect(readingSourceOf([true, false, true])).toBe("Mixed");
    expect(readingSourceOf([])).toBeNull();
  });
});

describe("parseForceInput", () => {
  it("reads a typed number and refuses anything else", () => {
    expect(parseForceInput(" 24.8 ")).toBe(24.8);
    expect(parseForceInput(".5")).toBe(0.5);
    expect(parseForceInput("-3")).toBeNull();
    expect(parseForceInput("24.8 lbF")).toBeNull();
    expect(parseForceInput("")).toBeNull();
  });
});

describe("pullResult", () => {
  it("is Fail, Pass, or Not judged when there's no minimum", () => {
    expect(pullResult({ failed: true, minimumForce: 10 })).toBe("Fail");
    expect(pullResult({ failed: false, minimumForce: 10 })).toBe("Pass");
    expect(pullResult({ failed: false, minimumForce: null })).toBe("Not judged");
  });
});

describe("labels", () => {
  it("formats forces as the tester shows them", () => {
    expect(formatForce(24.8)).toBe("24.8");
    expect(formatForce(25)).toBe("25.0");
    expect(formatForce(12.35)).toBe("12.35");
    expect(formatForce(null)).toBe("—");
    expect(minimumText(20, "lbF")).toBe("At least 20.0 lbF");
    expect(minimumText(null, "lbF")).toBe("No minimum");
    expect(minimumShort(35, "N")).toBe("≥ 35.0 N");
  });

  it("names an any-terminal spec as such", () => {
    expect(pullSpecLabel({ terminal: "", wireGauge: "18", reference: "IPC/WHMA-A-620" })).toBe(
      "Any terminal · 18 AWG · IPC/WHMA-A-620",
    );
    expect(pullSpecLabel({ terminal: "504041", wireGauge: "16", reference: "" })).toBe("504041 · 16 AWG");
  });

  it("builds the test title and the uniqueness key", () => {
    expect(buildPullTestTitle("504041", "18", "Start")).toBe("504041 / 18 AWG / Start");
    expect(buildPullTestTitle("", "", null)).toBe("(untitled pull test)");
    const key = (terminal: string, wireGauge: string, reference = "") => pullSpecKey({ terminal, wireGauge, reference });
    expect(key(" 504041 ", "18")).toBe(key("504041", "18"));
    expect(key("", "18")).not.toBe(key("504041", "18"));
    // A terminal has one spec per gauge, whatever document it cites.
    expect(key("504041", "18", "DS-1")).toBe(key("504041", "18", "DS-2"));
  });

  it("keys an any-terminal spec by its reference too, so a standard's columns can share a gauge", () => {
    const key = (reference: string) => pullSpecKey({ terminal: "", wireGauge: "20", reference });
    expect(key("IPC/WHMA-A-620 Table 19-8, crimp splices")).not.toBe(
      key("IPC/WHMA-A-620 Table 19-8, stamped and formed contacts and terminals"),
    );
    expect(key(" ipc/whma-a-620  table 19-8, crimp splices ")).toBe(key("IPC/WHMA-A-620 Table 19-8, crimp splices"));
  });
});

describe("failureModeSuggestions", () => {
  it("offers the standard answers until the floor has its own", () => {
    expect(failureModeSuggestions([])).toEqual({
      options: [...STANDARD_FAILURE_MODES],
      search: [...STANDARD_FAILURE_MODES],
    });
  });

  it("puts the answers used most first, then the standard ones nobody has used", () => {
    const { options } = failureModeSuggestions([
      "Insulation crimp let go",
      "Wire broke",
      "Insulation crimp let go",
      " ",
      "Insulation crimp let go",
      "Wire broke",
    ]);
    expect(options).toEqual(["Insulation crimp let go", "Wire broke", "Wire pulled out of crimp", "Terminal broke"]);
  });

  it("counts case and spacing differences as one answer, shown the way it's written most", () => {
    const { options } = failureModeSuggestions(["wire broke", "Wire  broke", "Wire broke", "Wire broke "]);
    expect(options.filter((o) => o.toLowerCase() === "wire broke")).toEqual(["Wire broke"]);
  });

  it("opens on a short list, and searches every answer as you type", () => {
    const used = Array.from({ length: FAILURE_MODE_SHORT_LIST + 4 }, (_, i) => `Mode ${String(i).padStart(2, "0")}`);
    const { options, search } = failureModeSuggestions(used);
    expect(options).toHaveLength(FAILURE_MODE_SHORT_LIST);
    expect(search).toHaveLength(used.length + STANDARD_FAILURE_MODES.length);
    expect(search).toContain("Terminal broke");
  });
});
