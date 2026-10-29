import { describe, expect, it } from "vitest";
import type { PanelTimeOff } from "@/types/task";
import {
  filterPanelTimeOff,
  panelTimeOffByDay,
  panelTimeOffLabel,
  panelTimeOffTitle,
} from "./panelTimeOff";

const d = (k: string) => new Date(`${k}T12:00:00Z`);
const entry = (over: Partial<PanelTimeOff> & { id: number }): PanelTimeOff => ({
  person: { displayName: "Sarah Shaffer", email: "sarah@example.com" },
  reason: "Vacation",
  startDate: d("2026-11-02"),
  endDate: d("2026-11-02"),
  companyHoliday: false,
  hoursPerDay: null,
  ...over,
});

describe("panelTimeOffByDay", () => {
  it("shows one entry on every day of its range, weekend included", () => {
    const map = panelTimeOffByDay([entry({ id: 1, startDate: d("2026-11-06"), endDate: d("2026-11-09") })]);
    expect([...map.keys()]).toEqual(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
  });

  it("lists a day's people by name, and skips an entry with no dates", () => {
    const map = panelTimeOffByDay([
      entry({ id: 1, person: { displayName: "Zed" } }),
      entry({ id: 2, person: { displayName: "Amy" } }),
      entry({ id: 3, startDate: null }),
    ]);
    expect(map.get("2026-11-02")?.map((e) => e.id)).toEqual([2, 1]);
  });
});

describe("labels", () => {
  it("names the person, with the hours when it's a part day", () => {
    expect(panelTimeOffLabel(entry({ id: 1 }))).toBe("Sarah Shaffer");
    expect(panelTimeOffLabel(entry({ id: 1, hoursPerDay: 4 }))).toBe("Sarah Shaffer · 4h");
    expect(panelTimeOffTitle(entry({ id: 1, hoursPerDay: 4 }))).toBe("Sarah Shaffer — Vacation (4h off)");
    expect(panelTimeOffTitle(entry({ id: 1, reason: "" }))).toBe("Sarah Shaffer (whole day)");
  });
});

describe("filterPanelTimeOff", () => {
  it("matches every word against the name or the reason", () => {
    const list = [entry({ id: 1 }), entry({ id: 2, person: { displayName: "Eric G" }, reason: "Training" })];
    expect(filterPanelTimeOff(list, "sarah vac").map((e) => e.id)).toEqual([1]);
    expect(filterPanelTimeOff(list, "training").map((e) => e.id)).toEqual([2]);
    expect(filterPanelTimeOff(list, "").length).toBe(2);
  });
});
