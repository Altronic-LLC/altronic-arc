import { describe, it, expect } from "vitest";
import { canEditEirWorkflow, EIR_WORKFLOW_EDITORS, EIR_WORKFLOW_HINT } from "./eirWorkflowEditors";

// BusinessIT#45: only Glenn, Brandon, Sheila — and Ray — may change an EIR's
// Status or assigned engineer.
describe("canEditEirWorkflow", () => {
  it.each([
    "glenn.terry@altronic-llc.com",
    "brandon.mirto@altronic-llc.com",
    "sheila.horn@altronic-llc.com",
    "ray.white@altronic-llc.com",
  ])("allows %s", (email) => {
    expect(canEditEirWorkflow([email])).toBe(true);
  });

  it("is exactly those four people", () => {
    expect(EIR_WORKFLOW_EDITORS).toHaveLength(4);
  });

  it("refuses anybody else, and nobody at all", () => {
    expect(canEditEirWorkflow(["sarah.shaffer@altronic-llc.com"])).toBe(false);
    expect(canEditEirWorkflow([])).toBe(false);
  });

  it("ignores case", () => {
    expect(canEditEirWorkflow(["Glenn.Terry@Altronic-LLC.com"])).toBe(true);
  });

  // A UPN is not a mailbox — the second address must count.
  it("matches on any address the account carries", () => {
    expect(
      canEditEirWorkflow(["g.terry@altronic-llc.com", "glenn.terry@altronic-llc.com"]),
    ).toBe(true);
  });

  it("names who can in the hint", () => {
    for (const name of ["Glenn Terry", "Brandon Mirto", "Sheila Horn", "Ray White"]) {
      expect(EIR_WORKFLOW_HINT).toContain(name);
    }
  });
});
