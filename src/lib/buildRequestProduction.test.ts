import { describe, it, expect } from "vitest";
import type { BuildRequest, BuildRequestItem, BuildRequestPartStatus, BuildRequestStatus } from "@/types/task";
import { canPressProduction, productionButtonState, productionTransitionRefusal } from "./buildRequestProduction";

const ENGINEER = { displayName: "Steven Pirko", email: "Steven.Pirko@altronic-llc.com", lookupId: 12 };

function br(status: BuildRequestStatus, overrides: Partial<BuildRequest> = {}): BuildRequest {
  return {
    id: 9,
    brNo: "BR_2026-0009",
    title: "Widget",
    product: "",
    status,
    brType: null,
    blockedReason: null,
    requiredLeadTime: null,
    quotedShipDate: null,
    samplePhase: null,
    requestor: null,
    engineerAssigned: ENGINEER,
    customerName: "",
    customerPO: "",
    leadFree: false,
    watchers: [],
    parentProjects: [],
    taskReferenceLookupId: null,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    author: null,
    comments: [],
    hasAttachments: false,
    ...overrides,
  };
}

let nextId = 100;
function part(partStatus: BuildRequestPartStatus | null): BuildRequestItem {
  return {
    id: nextId++,
    partNumber: "P-1",
    buildRequestLookupId: 9,
    projectRef: null,
    partDesc: "",
    drawingNo: "",
    drawingRev: "",
    qty: null,
    woNo: "",
    specialInstructions: "",
    testPlan: "",
    opSummary: "",
    serialNos: "",
    revisionDate: "",
    partType: null,
    partStatus,
    disposition: null,
    assembly: [],
    operations: [],
    testing: [],
    checklist: {},
    taskRefLookupId: null,
    watchers: [],
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    author: null,
    comments: [],
    hasAttachments: false,
  } as BuildRequestItem;
}

const PERMITTED = { permitted: true };
const NOT_PERMITTED = { permitted: false };
const ENGINEER_ACCESS = { isAdmin: false, myEmails: ["steve.pirko@altronic-llc.com", "steven.pirko@altronic-llc.com"] };
const ADMIN_ACCESS = { isAdmin: true, myEmails: ["ray.white@altronic-llc.com"] };
const OTHER_ACCESS = { isAdmin: false, myEmails: ["jane.doe@altronic-llc.com"] };
/** The named Production Complete approver (not an admin, not the engineer). */
const AMANDA_ACCESS = { isAdmin: false, myEmails: ["amanda.hoagland@altronic-llc.com"] };

describe("canPressProduction — who takes which step", () => {
  it("step 2 (Production Complete) allows Amanda Hoagland, whatever the case of her address", () => {
    expect(canPressProduction(br("Ready for Production"), AMANDA_ACCESS)).toBe(true);
    expect(
      canPressProduction(br("Ready for Production"), { isAdmin: false, myEmails: ["AMANDA.HOAGLAND@ALTRONIC-LLC.COM"] }),
    ).toBe(true);
  });

  it("step 2 refuses the assigned engineer", () => {
    expect(canPressProduction(br("Ready for Production"), ENGINEER_ACCESS)).toBe(false);
  });

  it("step 2 allows an admin", () => {
    expect(canPressProduction(br("Ready for Production"), ADMIN_ACCESS)).toBe(true);
  });

  it("step 1 (Ready for Production) refuses Amanda unless she's the engineer", () => {
    expect(canPressProduction(br("In-process"), AMANDA_ACCESS)).toBe(false);
  });

  it("an explicit target overrides the step the status offers", () => {
    expect(canPressProduction(br("In-process"), AMANDA_ACCESS, "Production Complete")).toBe(true);
    expect(canPressProduction(br("In-process"), ENGINEER_ACCESS, "Production Complete")).toBe(false);
  });
});

describe("canPressProduction", () => {
  it("allows the assigned engineer, matching case-insensitively", () => {
    expect(canPressProduction(br("In-process"), { isAdmin: false, myEmails: ["STEVEN.PIRKO@ALTRONIC-LLC.COM"] })).toBe(true);
  });

  it("matches any of the signed-in user's addresses", () => {
    expect(canPressProduction(br("In-process"), ENGINEER_ACCESS)).toBe(true);
  });

  it("allows an ARC admin who is not the engineer", () => {
    expect(canPressProduction(br("In-process"), ADMIN_ACCESS)).toBe(true);
  });

  it("allows an admin even when no engineer is assigned", () => {
    expect(canPressProduction(br("In-process", { engineerAssigned: null }), ADMIN_ACCESS)).toBe(true);
  });

  it("refuses anyone else", () => {
    expect(canPressProduction(br("In-process"), OTHER_ACCESS)).toBe(false);
  });

  it("refuses a non-admin when no engineer is assigned", () => {
    expect(canPressProduction(br("In-process", { engineerAssigned: null }), OTHER_ACCESS)).toBe(false);
  });

  it("refuses a non-admin when the engineer has no email to match", () => {
    const b = br("In-process", { engineerAssigned: { displayName: "User #12", lookupId: 12 } });
    expect(canPressProduction(b, ENGINEER_ACCESS)).toBe(false);
  });

  it("refuses a user with no addresses at all", () => {
    expect(canPressProduction(br("In-process"), { isAdmin: false, myEmails: [] })).toBe(false);
  });
});

describe("productionButtonState — step 1 (Ready for Production)", () => {
  it("offers Ready for Production on an in-process request", () => {
    const s = productionButtonState(br("In-process"), [part("Ready for Production")], PERMITTED);
    expect(s.action).toBe("ready-for-production");
    expect(s.label).toBe("Ready for Production");
    expect(s.targetStatus).toBe("Ready for Production");
    expect(s.allowed).toBe(true);
    expect(s.hint).toMatch(/Ready for Production/);
  });

  it.each<BuildRequestStatus>(["Submitted", "Blocked", "Information Needed", "On Hold"])(
    "offers step 1 at %s too",
    (status) => {
      expect(productionButtonState(br(status), [part("Ready for Production")], PERMITTED).action).toBe(
        "ready-for-production",
      );
    },
  );

  it("is never ready with no parts", () => {
    const s = productionButtonState(br("In-process"), [], PERMITTED);
    expect(s.partsReady).toBe(false);
    expect(s.allowed).toBe(false);
    expect(s.blockingParts).toBe(0);
    expect(s.hint).toMatch(/at least one part/i);
  });

  it("counts Production Complete parts as ready for step 1", () => {
    const s = productionButtonState(
      br("In-process"),
      [part("Production Complete"), part("Ready for Production")],
      PERMITTED,
    );
    expect(s.partsReady).toBe(true);
    expect(s.blockingParts).toBe(0);
    expect(s.allowed).toBe(true);
  });

  it("blocks on mixed statuses and says how many parts are behind", () => {
    const s = productionButtonState(
      br("In-process"),
      [part("Ready for Production"), part("Review Checklist"), part("On Hold"), part(null)],
      PERMITTED,
    );
    expect(s.partsReady).toBe(false);
    expect(s.blockingParts).toBe(3);
    expect(s.allowed).toBe(false);
    expect(s.hint).toBe("3 parts still need to reach Ready for Production.");
  });

  it("uses the singular for one blocking part", () => {
    const s = productionButtonState(br("In-process"), [part("Information Needed")], PERMITTED);
    expect(s.hint).toBe("1 part still needs to reach Ready for Production.");
  });

  it("is not allowed for someone not permitted, even when every part is ready", () => {
    const s = productionButtonState(br("In-process"), [part("Ready for Production")], NOT_PERMITTED);
    expect(s.partsReady).toBe(true);
    expect(s.allowed).toBe(false);
    expect(s.hint).toMatch(/assigned engineer or an ARC admin can move this build request to Ready for Production/);
  });

  it("gives both reasons when neither the parts nor the person qualify", () => {
    const s = productionButtonState(br("In-process"), [part("Review Checklist")], NOT_PERMITTED);
    expect(s.hint).toMatch(/assigned engineer or an ARC admin/);
    expect(s.hint).toMatch(/1 part still needs/);
  });
});

describe("productionButtonState — step 2 (Production Complete)", () => {
  it("offers Build Request Production Complete once Ready for Production", () => {
    const s = productionButtonState(br("Ready for Production"), [part("Production Complete")], PERMITTED);
    expect(s.action).toBe("production-complete");
    expect(s.label).toBe("Build Request Production Complete");
    expect(s.targetStatus).toBe("Production Complete");
    expect(s.allowed).toBe(true);
  });

  it("does NOT count Ready for Production parts as done for step 2", () => {
    const s = productionButtonState(
      br("Ready for Production"),
      [part("Production Complete"), part("Ready for Production")],
      PERMITTED,
    );
    expect(s.partsReady).toBe(false);
    expect(s.blockingParts).toBe(1);
    expect(s.allowed).toBe(false);
    expect(s.hint).toBe("1 part still needs to reach Production Complete.");
  });

  it("is never ready with no parts", () => {
    const s = productionButtonState(br("Ready for Production"), [], PERMITTED);
    expect(s.allowed).toBe(false);
    expect(s.hint).toMatch(/at least one part/i);
  });

  it("is not allowed for someone not permitted", () => {
    const s = productionButtonState(br("Ready for Production"), [part("Production Complete")], NOT_PERMITTED);
    expect(s.allowed).toBe(false);
    expect(s.hint).toMatch(/Only Amanda Hoagland or an ARC admin/);
  });
});

describe("productionButtonState — no button", () => {
  it.each<BuildRequestStatus>(["Production Complete", "Complete"])("offers nothing at %s", (status) => {
    const s = productionButtonState(br(status), [part("Production Complete")], PERMITTED);
    expect(s.action).toBeNull();
    expect(s.label).toBe("");
    expect(s.targetStatus).toBeNull();
    expect(s.allowed).toBe(false);
  });

  it("says a Production Complete request is waiting on review", () => {
    expect(productionButtonState(br("Production Complete"), [], PERMITTED).hint).toMatch(/review/i);
  });
});

describe("productionTransitionRefusal", () => {
  it.each(["Submitted", "In-process", "Blocked", "Complete", "On Hold", "Information Needed"])(
    "returns null for the ungated target %s, even for someone not permitted with no parts ready",
    (target) => {
      expect(productionTransitionRefusal(br("In-process"), [part("Review Checklist")], target, OTHER_ACCESS)).toBeNull();
    },
  );

  it("allows the engineer to move to Ready for Production when every part is ready", () => {
    expect(
      productionTransitionRefusal(br("In-process"), [part("Ready for Production")], "Ready for Production", ENGINEER_ACCESS),
    ).toBeNull();
  });

  it("allows an admin the same move", () => {
    expect(
      productionTransitionRefusal(br("In-process"), [part("Production Complete")], "Ready for Production", ADMIN_ACCESS),
    ).toBeNull();
  });

  it("refuses someone who isn't the engineer or an admin, even with every part ready", () => {
    expect(
      productionTransitionRefusal(br("In-process"), [part("Ready for Production")], "Ready for Production", OTHER_ACCESS),
    ).toMatch(/assigned engineer or an ARC admin/);
  });

  it("refuses Ready for Production while parts are behind, naming the count", () => {
    expect(
      productionTransitionRefusal(
        br("In-process"),
        [part("Ready for Production"), part("Review Checklist"), part("On Hold")],
        "Ready for Production",
        ENGINEER_ACCESS,
      ),
    ).toBe("2 parts still need to reach Ready for Production.");
  });

  it("refuses Ready for Production with no parts", () => {
    expect(productionTransitionRefusal(br("In-process"), [], "Ready for Production", ADMIN_ACCESS)).toMatch(
      /at least one part/i,
    );
  });

  it("allows Production Complete from Ready for Production when every part is Production Complete", () => {
    expect(
      productionTransitionRefusal(
        br("Ready for Production"),
        [part("Production Complete"), part("Production Complete")],
        "Production Complete",
        AMANDA_ACCESS,
      ),
    ).toBeNull();
  });

  it("refuses Production Complete while a part is only Ready for Production", () => {
    expect(
      productionTransitionRefusal(
        br("Ready for Production"),
        [part("Production Complete"), part("Ready for Production")],
        "Production Complete",
        AMANDA_ACCESS,
      ),
    ).toBe("1 part still needs to reach Production Complete.");
  });

  it("refuses skipping straight to Production Complete, even with every part done", () => {
    expect(
      productionTransitionRefusal(br("In-process"), [part("Production Complete")], "Production Complete", ADMIN_ACCESS),
    ).toMatch(/only be set to Production Complete from Ready for Production/);
  });

  it("refuses Production Complete for someone not permitted", () => {
    expect(
      productionTransitionRefusal(
        br("Ready for Production"),
        [part("Production Complete")],
        "Production Complete",
        OTHER_ACCESS,
      ),
    ).toMatch(/Only Amanda Hoagland or an ARC admin/);
  });

  // The engineer hands to production; production signs off it's done.
  it("refuses the ASSIGNED ENGINEER at Production Complete, even with every part done", () => {
    expect(
      productionTransitionRefusal(
        br("Ready for Production"),
        [part("Production Complete")],
        "Production Complete",
        ENGINEER_ACCESS,
      ),
    ).toMatch(/Only Amanda Hoagland or an ARC admin/);
  });

  it("does not judge a re-save of the status the request already has", () => {
    // Fixture is already AT the target, with parts that would fail the rule
    // and a user who isn't permitted — only the no-change guard lets it pass.
    expect(
      productionTransitionRefusal(
        br("Ready for Production"),
        [part("Review Checklist")],
        "Ready for Production",
        OTHER_ACCESS,
      ),
    ).toBeNull();
  });
});
