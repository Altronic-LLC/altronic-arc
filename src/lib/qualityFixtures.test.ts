import { describe, expect, it } from "vitest";
import type { GraphListItem } from "@/types/task";
import type { QualityFixture } from "@/types/qualityFixture";
import {
  buildQualityFixtureFields,
  compareFixtures,
  fixtureNumberProblem,
  fixtureNumberValue,
  inFixtureScope,
  nextFixtureNumber,
  normalizeFixtureNumber,
  parseFixtureScope,
  qualityFixtureInputFrom,
  qualityFixtureLabel,
  qualityFixtureMatches,
  toQualityFixture,
} from "./qualityFixtures";

function item(id: number, fields: Record<string, unknown>): GraphListItem {
  return {
    id: String(id),
    createdDateTime: "2026-02-27T16:06:10Z",
    lastModifiedDateTime: "2026-02-27T16:06:10Z",
    fields,
  } as GraphListItem;
}

function fx(id: number, number: string, extra: Partial<QualityFixture> = {}): QualityFixture {
  return {
    id,
    number,
    description: "",
    comment: "",
    location: "",
    partNumbers: "",
    active: true,
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...extra,
  };
}

describe("toQualityFixture", () => {
  it("reads QFLOG's field_N columns by what they mean", () => {
    const f = toQualityFixture(
      item(7, {
        Title: " QF65 ",
        field_1: "FLANGE DRIVE COUPLING TANG GAUGE",
        field_2: "see drawing",
        Location: "Gauge cabinet",
        PartNumbers: "123456\n654321",
        Active: false,
        Attachments: true,
      }),
    );
    expect(f).toMatchObject({
      id: 7,
      number: "QF65",
      description: "FLANGE DRIVE COUPLING TANG GAUGE",
      comment: "see drawing",
      location: "Gauge cabinet",
      partNumbers: "123456\n654321",
      active: false,
      hasAttachments: true,
    });
  });

  it("reads a blank Active as ACTIVE — the rows from before the column existed are in use", () => {
    expect(toQualityFixture(item(1, { Title: "QF1" })).active).toBe(true);
    expect(toQualityFixture(item(1, { Title: "QF1", Active: null })).active).toBe(true);
    expect(toQualityFixture(item(1, { Title: "QF1", Active: true })).active).toBe(true);
  });
});

describe("fixture numbers", () => {
  it("normalizes case and spaces", () => {
    expect(normalizeFixtureNumber(" qf 12 ")).toBe("QF12");
    expect(normalizeFixtureNumber("qf63a")).toBe("QF63A");
  });

  it("reads the number part, letter or not", () => {
    expect(fixtureNumberValue("QF390")).toBe(390);
    expect(fixtureNumberValue("QF63B")).toBe(63);
    expect(fixtureNumberValue("FX12")).toBeNull();
  });

  it("offers one past the HIGHEST, never count + 1 (the log jumps QF99 → QF200)", () => {
    const log = [fx(1, "QF1"), fx(2, "QF63A"), fx(3, "QF99"), fx(4, "QF200"), fx(5, "QF390", { active: false })];
    expect(nextFixtureNumber(log)).toBe("QF391");
    expect(nextFixtureNumber([])).toBe("QF1");
  });

  it("refuses a blank, a malformed or a taken number — retired ones included, any case", () => {
    const others = [fx(1, "QF12"), fx(2, "QF40", { active: false })];
    expect(fixtureNumberProblem("", others)).toMatch(/required/);
    expect(fixtureNumberProblem("12", others)).toMatch(/QF followed by a number/);
    expect(fixtureNumberProblem("QF12AB", others)).toMatch(/QF followed by a number/);
    expect(fixtureNumberProblem("qf 12", others)).toBe("QF12 is already on the log.");
    expect(fixtureNumberProblem("QF40", others)).toBe("QF40 is already on the log.");
    expect(fixtureNumberProblem("QF391", others)).toBeNull();
    expect(fixtureNumberProblem("QF63A", others)).toBeNull();
  });

  it("sorts in log order", () => {
    const sorted = [fx(1, "QF200"), fx(2, "QF64"), fx(3, "QF63B"), fx(4, "QF2"), fx(5, "QF63A")].sort(compareFixtures);
    expect(sorted.map((f) => f.number)).toEqual(["QF2", "QF63A", "QF63B", "QF64", "QF200"]);
  });

  it("labels a fixture by number and description", () => {
    expect(qualityFixtureLabel({ number: "QF1", description: "STATOR" })).toBe("QF1 — STATOR");
    expect(qualityFixtureLabel({ number: "QF1", description: "" })).toBe("QF1");
  });
});

describe("buildQualityFixtureFields", () => {
  const before = fx(3, "QF3", { description: "GAUGE", location: "Cabinet", active: true });

  it("writes every column on create, under QFLOG's names", () => {
    expect(
      buildQualityFixtureFields({
        number: " qf391 ",
        description: " Tester ",
        comment: "",
        location: "Bench",
        partNumbers: "1\n2",
        active: true,
      }),
    ).toEqual({ Title: "QF391", field_1: "Tester", field_2: "", Location: "Bench", PartNumbers: "1\n2", Active: true });
  });

  it("sends only what changed on an edit", () => {
    expect(buildQualityFixtureFields({ ...qualityFixtureInputFrom(before), location: "Bench 2" }, before)).toEqual({
      Location: "Bench 2",
    });
    expect(buildQualityFixtureFields({ ...qualityFixtureInputFrom(before), active: false }, before)).toEqual({
      Active: false,
    });
  });

  it("sends nothing when nothing changed", () => {
    expect(buildQualityFixtureFields(qualityFixtureInputFrom(before), before)).toEqual({});
  });
});

describe("search and scope", () => {
  const f = fx(1, "QF200", { description: "Coil firing adapter", location: "Coil room", partNumbers: "900100-01" });

  it("needs every word, anywhere", () => {
    expect(qualityFixtureMatches(f, ["coil", "900100"])).toBe(true);
    expect(qualityFixtureMatches(f, ["qf200"])).toBe(true);
    expect(qualityFixtureMatches(f, ["coil", "harness"])).toBe(false);
    expect(qualityFixtureMatches(f, [])).toBe(true);
  });

  it("opens on active, and ignores an unknown ?show=", () => {
    expect(parseFixtureScope(null)).toBe("active");
    expect(parseFixtureScope("bogus")).toBe("active");
    expect(parseFixtureScope("retired")).toBe("retired");
    expect(parseFixtureScope("all")).toBe("all");
    const retired = fx(2, "QF5", { active: false });
    expect(inFixtureScope(f, "active")).toBe(true);
    expect(inFixtureScope(retired, "active")).toBe(false);
    expect(inFixtureScope(retired, "retired")).toBe(true);
    expect(inFixtureScope(f, "retired")).toBe(false);
    expect(inFixtureScope(retired, "all")).toBe(true);
  });
});
