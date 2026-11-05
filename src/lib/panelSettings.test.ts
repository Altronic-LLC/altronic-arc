import { describe, expect, it } from "vitest";
import { amberPercentProblem, DEFAULT_PANEL_SETTINGS, parsePanelSettings } from "./panelSettings";

describe("panel settings", () => {
  it("defaults the amber threshold to 85%", () => {
    expect(DEFAULT_PANEL_SETTINGS.amberPercent).toBe(85);
    expect(parsePanelSettings({})).toEqual({ amberPercent: 85 });
  });

  it("reads a stored threshold, and falls back on one it can't use", () => {
    expect(parsePanelSettings({ CapacityAmberPercent: "90" }).amberPercent).toBe(90);
    for (const bad of ["", "abc", "12", "101", "87.5"]) {
      expect(parsePanelSettings({ CapacityAmberPercent: bad }).amberPercent).toBe(85);
    }
  });

  it("accepts a whole percentage from 50 to 100", () => {
    expect(amberPercentProblem(50)).toBeNull();
    expect(amberPercentProblem(100)).toBeNull();
    expect(amberPercentProblem(49)).toMatch(/50 to 100/);
    expect(amberPercentProblem(90.5)).toMatch(/whole/);
  });
});
