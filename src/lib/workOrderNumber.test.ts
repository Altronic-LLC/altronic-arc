import { describe, it, expect } from "vitest";
import type { MaintenanceTask } from "@/types/task";
import { nextWorkOrderNumber } from "./workOrderNumber";

const wo = (woNumber: string) => ({ woNumber }) as MaintenanceTask;
const NOW = new Date("2026-08-27T12:00:00Z");

describe("nextWorkOrderNumber", () => {
  it("starts at 0001 on an empty list", () => {
    expect(nextWorkOrderNumber([], NOW)).toBe("WO-2026-0001");
  });

  it("takes the highest existing number for the year, not the count", () => {
    // A gap left by a number typed by hand must not be re-issued.
    expect(nextWorkOrderNumber([wo("WO-2026-0001"), wo("WO-2026-0009")], NOW)).toBe("WO-2026-0010");
  });

  it("ignores numbers from other years, so the count restarts each January", () => {
    expect(nextWorkOrderNumber([wo("WO-2025-0412")], NOW)).toBe("WO-2026-0001");
  });

  it("recognises a hand-typed underscore form while scanning", () => {
    expect(nextWorkOrderNumber([wo("WO_2026-7")], NOW)).toBe("WO-2026-0008");
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(nextWorkOrderNumber([wo("  wo-2026-0004  ")], NOW)).toBe("WO-2026-0005");
  });

  it("ignores anything that isn't a WO number at all", () => {
    expect(nextWorkOrderNumber([wo(""), wo("see the log book"), wo("EIR_2026-0044")], NOW)).toBe(
      "WO-2026-0001",
    );
  });

  it("pads past four digits rather than truncating", () => {
    expect(nextWorkOrderNumber([wo("WO-2026-9999")], NOW)).toBe("WO-2026-10000");
  });
});
