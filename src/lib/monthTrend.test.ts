import { describe, expect, it } from "vitest";
import type { MonthlyFpy } from "./monthlyYield";
import {
  MIN_UNITS_FOR_COMPARISON,
  metricValue,
  monthTrend,
  unitsNeededToCompare,
} from "./monthTrend";

function month(label: string, unitsTested: number, unitsFailed: number): MonthlyFpy {
  return {
    monthKey: `2026-${label}`,
    label,
    unitsTested,
    unitsFailed,
    fpyPercent: unitsTested > 0 ? ((unitsTested - unitsFailed) / unitsTested) * 100 : null,
  };
}

describe("metricValue", () => {
  it("reads FPY as-is and the failure rate as its complement", () => {
    const m = month("Sep", 1000, 50);
    expect(metricValue(m, "fpy")).toBeCloseTo(95);
    expect(metricValue(m, "failureRate")).toBeCloseTo(5);
  });

  it("is null for a month with nothing tested, for either metric", () => {
    expect(metricValue(month("Oct", 0, 0), "fpy")).toBeNull();
    expect(metricValue(month("Oct", 0, 0), "failureRate")).toBeNull();
  });
});

describe("unitsNeededToCompare", () => {
  it("caps at the fixed minimum for a high-volume month", () => {
    expect(unitsNeededToCompare(month("Sep", 4664, 252))).toBe(MIN_UNITS_FOR_COMPARISON);
  });

  it("drops to a quarter of last month for a low-volume source", () => {
    expect(unitsNeededToCompare(month("Sep", 40, 2))).toBe(10);
  });

  it("never asks for fewer than one unit", () => {
    expect(unitsNeededToCompare(month("Sep", 1, 0))).toBe(1);
  });
});

describe("monthTrend", () => {
  it("has nothing to say with fewer than two months", () => {
    expect(monthTrend([], "fpy")).toEqual({ kind: "none" });
    expect(monthTrend([month("Oct", 500, 5)], "fpy")).toEqual({ kind: "none" });
  });

  it("compares the LAST month with the one before it, ignoring older months", () => {
    const trend = monthTrend(
      [month("Aug", 1000, 500), month("Sep", 1000, 60), month("Oct", 1000, 40)],
      "fpy",
    );
    expect(trend.kind).toBe("compare");
    if (trend.kind !== "compare") return;
    expect(trend.currentLabel).toBe("Oct");
    expect(trend.previousLabel).toBe("Sep");
    expect(trend.value).toBeCloseTo(96);
    expect(trend.delta).toBeCloseTo(2);
    expect(trend.direction).toBe("up");
  });

  it("calls FPY going up good and going down bad", () => {
    const up = monthTrend([month("Sep", 1000, 60), month("Oct", 1000, 40)], "fpy");
    const down = monthTrend([month("Sep", 1000, 40), month("Oct", 1000, 60)], "fpy");
    expect(up.kind === "compare" && up.good).toBe(true);
    expect(down.kind === "compare" && down.direction).toBe("down");
    expect(down.kind === "compare" && down.good).toBe(false);
  });

  it("calls the failure rate going DOWN good — the opposite of FPY", () => {
    const fewerFailures = monthTrend(
      [month("Sep", 1000, 60), month("Oct", 1000, 40)],
      "failureRate",
    );
    expect(fewerFailures.kind).toBe("compare");
    if (fewerFailures.kind !== "compare") return;
    expect(fewerFailures.direction).toBe("down");
    expect(fewerFailures.good).toBe(true);
    expect(fewerFailures.value).toBeCloseTo(4);

    const moreFailures = monthTrend(
      [month("Sep", 1000, 40), month("Oct", 1000, 60)],
      "failureRate",
    );
    expect(moreFailures.kind === "compare" && moreFailures.good).toBe(false);
  });

  it("compares RATES, so a partial month's lower volume isn't a drop", () => {
    // Sep: 4,664 tested. Oct so far: 1,980 — 58% fewer units, but a better yield.
    const trend = monthTrend([month("Sep", 4664, 252), month("Oct", 1980, 88)], "fpy");
    expect(trend.kind === "compare" && trend.direction).toBe("up");
  });

  it("reads a change too small to print as no change, neither good nor bad", () => {
    const trend = monthTrend([month("Sep", 10000, 500), month("Oct", 10000, 503)], "fpy");
    expect(trend.kind).toBe("compare");
    if (trend.kind !== "compare") return;
    expect(trend.direction).toBe("flat");
    expect(trend.good).toBeNull();
  });

  it("is too early to compare until the month has tested enough units", () => {
    const trend = monthTrend([month("Sep", 4664, 252), month("Oct", 30, 5)], "fpy");
    expect(trend.kind).toBe("too-early");
    if (trend.kind !== "too-early") return;
    expect(trend.unitsSoFar).toBe(30);
    expect(trend.unitsNeeded).toBe(MIN_UNITS_FOR_COMPARISON);
    expect(trend.value).toBeCloseTo((25 / 30) * 100);
  });

  it("compares as soon as the month reaches the minimum exactly", () => {
    const trend = monthTrend(
      [month("Sep", 4664, 252), month("Oct", MIN_UNITS_FOR_COMPARISON, 4)],
      "fpy",
    );
    expect(trend.kind).toBe("compare");
  });

  it("is too early, with no value, when nothing is tested this month yet", () => {
    const trend = monthTrend([month("Sep", 4664, 252), month("Oct", 0, 0)], "fpy");
    expect(trend.kind).toBe("too-early");
    expect(trend.kind !== "none" && trend.value).toBeNull();
  });

  it("says there's nothing to compare with when last month tested nothing", () => {
    const trend = monthTrend([month("Sep", 0, 0), month("Oct", 500, 5)], "fpy");
    expect(trend.kind).toBe("no-previous");
    if (trend.kind !== "no-previous") return;
    expect(trend.previousLabel).toBe("Sep");
    expect(trend.value).toBeCloseTo(99);
  });
});
