import { describe, it, expect } from "vitest";
import { matchesEirView } from "./EirsView";
import type { Eir } from "@/types/task";

// matchesEirView only reads parentProjects + assignedEngineers, so build a
// minimal EIR with just those two arrays sized as needed.
function eir(projectCount: number, engineerCount: number): Eir {
  return {
    parentProjects: Array.from({ length: projectCount }, (_, i) => ({
      lookupId: i + 1,
      title: `P${i + 1}`,
    })),
    assignedEngineers: Array.from({ length: engineerCount }, (_, i) => ({
      displayName: `Eng ${i + 1}`,
    })),
  } as unknown as Eir;
}

describe("matchesEirView", () => {
  it("New = no project AND no engineer", () => {
    expect(matchesEirView(eir(0, 0), "new")).toBe(true);
    expect(matchesEirView(eir(1, 0), "new")).toBe(false); // has a project
    expect(matchesEirView(eir(0, 1), "new")).toBe(false); // has an engineer
    expect(matchesEirView(eir(2, 2), "new")).toBe(false);
  });

  it("Needs Assigned = has a project but no engineer", () => {
    expect(matchesEirView(eir(1, 0), "needs-assigned")).toBe(true);
    expect(matchesEirView(eir(3, 0), "needs-assigned")).toBe(true);
    expect(matchesEirView(eir(0, 0), "needs-assigned")).toBe(false); // no project
    expect(matchesEirView(eir(1, 1), "needs-assigned")).toBe(false); // already assigned
  });

  it("All matches everything", () => {
    expect(matchesEirView(eir(0, 0), "all")).toBe(true);
    expect(matchesEirView(eir(1, 0), "all")).toBe(true);
    expect(matchesEirView(eir(2, 3), "all")).toBe(true);
  });

  it("At Risk Parts = RiskPart is Active", () => {
    const withRisk = (riskPart: string | null) =>
      ({ parentProjects: [], assignedEngineers: [], riskPart }) as unknown as Eir;
    expect(matchesEirView(withRisk("Active"), "at-risk")).toBe(true);
    expect(matchesEirView(withRisk("InActive"), "at-risk")).toBe(false);
    expect(matchesEirView(withRisk(null), "at-risk")).toBe(false);
  });
});
