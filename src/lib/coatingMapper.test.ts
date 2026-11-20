import { describe, expect, it } from "vitest";
import { toCoatedSides, toCoatingCheck, toCoatingSpec, toCoatingUnit } from "./coatingMapper";

const meta = { createdDateTime: "2026-11-04T10:00:00Z", lastModifiedDateTime: "2026-11-04T10:00:00Z" };

describe("coatingMapper", () => {
  it("reads an unknown unit as millimetres, the default", () => {
    expect(toCoatingUnit("in")).toBe("in");
    expect(toCoatingUnit("MM")).toBe("mm");
    expect(toCoatingUnit("")).toBe("mm");
    expect(toCoatingUnit(undefined)).toBe("mm");
  });

  it("reads coated sides as 2 only when it says 2", () => {
    expect(toCoatedSides(2)).toBe(2);
    expect(toCoatedSides("2")).toBe(2);
    expect(toCoatedSides(null)).toBe(1);
    expect(toCoatedSides(3)).toBe(1);
  });

  it("reads a spec, a missing Active as active and a missing SpecUnit as mm", () => {
    const spec = toCoatingSpec({ id: "4", fields: { Title: " Acrylic ", MinMm: "0.025", MaxMm: 0.075 }, ...meta } as never);
    expect(spec).toMatchObject({ id: 4, name: "Acrylic", minMm: 0.025, maxMm: 0.075, specUnit: "mm", coatedSides: 1, active: true });
    expect(toCoatingSpec({ id: "5", fields: { SpecUnit: "in" }, ...meta } as never).specUnit).toBe("in");
  });

  it("reads a check's single SpecRef lookup from the bare id Graph sends", () => {
    const check = toCoatingCheck({
      id: "7",
      fields: { SpecRefLookupId: "3", ThicknessMm: 0.05, ThicknessMils: 1.97, Unit: "in", Machine: "SPRAY-1" },
      ...meta,
    } as never);
    expect(check).toMatchObject({ id: 7, specId: 3, thicknessMm: 0.05, thicknessMils: 1.97, unit: "in", machine: "SPRAY-1" });
  });
});
