import { describe, it, expect } from "vitest";
import type { Fait, Person } from "@/types/task";
import {
  ENG_SIGN_OFF_COLUMN,
  FAIT_STATUS_WITH_ENG,
  FAIT_STATUS_WITH_KAM,
  SQE_SIGN_OFF_COLUMN,
  faitSignOffOutcome,
  kamNeeded,
} from "./faitSignOff";

// =============================================================================
// The sign-off chain's rules.
//
// Every guard here exists because the same mistake has been made elsewhere in
// ARC: `"SQESignOff" in fields` is PRESENCE, not change, so the "stays quiet"
// cases below start from a FAIT that ALREADY holds the target value — with a
// fixture starting anywhere else they'd pass whether the guard existed or not.
// =============================================================================

const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

function aFait(over: Partial<Fait> = {}, values: Record<string, string> = {}): Fait {
  return {
    id: 1,
    title: "",
    status: "This is with SQE",
    parentProject: null,
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: RAY,
    assignedEngineer: null,
    kam: null,
    watchers: [],
    comments: [],
    hasAttachments: false,
    values: { sqeSignOff: "", engSignOff: "", kamSignOff: "", ...values },
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...over,
  } as Fait;
}

describe("kamNeeded", () => {
  it("is false when there's no KAM and no KAM sign-off data at all", () => {
    expect(kamNeeded(aFait())).toBe(false);
  });

  it("is true the moment a KAM is assigned", () => {
    expect(kamNeeded(aFait({ kam: RAY }))).toBe(true);
  });

  // A FAIT signed off before there was any way to assign a KAM person still
  // has a real sign-off, and it must not be hidden out from under it.
  it("is true when KAM sign-off data exists without a KAM person", () => {
    expect(kamNeeded(aFait({}, { kamSignOff: "Approved" }))).toBe(true);
    expect(kamNeeded(aFait({}, { kamInitials: "rw" }))).toBe(true);
    expect(kamNeeded(aFait({}, { kamApprovalNotes: "fine by me" }))).toBe(true);
  });
});

describe("SQE sign-off", () => {
  it("approving asks for the engineer and advances the status", () => {
    const out = faitSignOffOutcome(aFait(), { [SQE_SIGN_OFF_COLUMN]: "Approved" });
    expect(out.steps).toEqual([{ kind: "sqe-approved" }]);
    expect(out.nextStatus).toBe(FAIT_STATUS_WITH_ENG);
  });

  // THE GUARD. A fixture already AT Approved is the only case where deleting
  // `to !== from` would actually fail this test.
  it("stays quiet when an already-approved sign-off is re-saved", () => {
    const out = faitSignOffOutcome(aFait({}, { sqeSignOff: "Approved" }), {
      [SQE_SIGN_OFF_COLUMN]: "Approved",
    });
    expect(out.steps).toEqual([]);
    expect(out.nextStatus).toBeNull();
  });

  it("matches loosely, so stored casing doesn't re-fire it", () => {
    const out = faitSignOffOutcome(aFait({}, { sqeSignOff: "approved" }), {
      [SQE_SIGN_OFF_COLUMN]: "Approved",
    });
    expect(out.steps).toEqual([]);
  });

  it("does nothing at all when the column isn't in the write", () => {
    expect(faitSignOffOutcome(aFait(), { SQEINITIALS: "jw" })).toEqual({
      steps: [],
      nextStatus: null,
    });
  });

  // Pending is a real choice and means nothing has happened yet.
  it("ignores a move to Pending", () => {
    expect(faitSignOffOutcome(aFait(), { [SQE_SIGN_OFF_COLUMN]: "Pending" }).steps).toEqual([]);
  });

  // ASSUMPTION under test: Failed goes BACK, not forward.
  it("Failed reports the failure and does NOT advance the status", () => {
    const out = faitSignOffOutcome(aFait(), { [SQE_SIGN_OFF_COLUMN]: "Failed" });
    expect(out.steps).toEqual([{ kind: "sqe-failed" }]);
    expect(out.nextStatus).toBeNull();
  });

  it("stays quiet when an already-failed sign-off is re-saved", () => {
    const out = faitSignOffOutcome(aFait({}, { sqeSignOff: "Failed" }), {
      [SQE_SIGN_OFF_COLUMN]: "Failed",
    });
    expect(out.steps).toEqual([]);
  });
});

describe("engineering sign-off", () => {
  it("approving advances to the KAM when one is owed", () => {
    const out = faitSignOffOutcome(aFait({ kam: RAY, status: FAIT_STATUS_WITH_ENG }), {
      [ENG_SIGN_OFF_COLUMN]: "Approved",
    });
    expect(out.steps).toEqual([{ kind: "eng-approved", kamOwed: true }]);
    expect(out.nextStatus).toBe(FAIT_STATUS_WITH_KAM);
  });

  // The chain finishes at the engineer when nobody owes a KAM signature —
  // parking the FAIT at "This is with KAM" would leave it waiting for ever.
  it("does NOT advance to the KAM when no KAM is owed", () => {
    const out = faitSignOffOutcome(aFait({ status: FAIT_STATUS_WITH_ENG }), {
      [ENG_SIGN_OFF_COLUMN]: "Approved",
    });
    expect(out.steps).toEqual([{ kind: "eng-approved", kamOwed: false }]);
    expect(out.nextStatus).toBeNull();
  });

  it("stays quiet when an already-approved sign-off is re-saved", () => {
    const out = faitSignOffOutcome(aFait({ kam: RAY }, { engSignOff: "Approved" }), {
      [ENG_SIGN_OFF_COLUMN]: "Approved",
    });
    expect(out.steps).toEqual([]);
  });

  it("clearing it back to blank asks nobody for anything", () => {
    const out = faitSignOffOutcome(aFait({ kam: RAY }, { engSignOff: "Approved" }), {
      [ENG_SIGN_OFF_COLUMN]: "",
    });
    expect(out.steps).toEqual([]);
    expect(out.nextStatus).toBeNull();
  });
});

describe("both sign-offs in one save of the Sign-off card", () => {
  it("reports both steps, and the LATER link decides the status", () => {
    const out = faitSignOffOutcome(aFait({ kam: RAY }), {
      [SQE_SIGN_OFF_COLUMN]: "Approved",
      [ENG_SIGN_OFF_COLUMN]: "Approved",
    });
    expect(out.steps).toEqual([{ kind: "sqe-approved" }, { kind: "eng-approved", kamOwed: true }]);
    expect(out.nextStatus).toBe(FAIT_STATUS_WITH_KAM);
  });

  it("leaves the status alone when the chain finishes with no KAM owed", () => {
    const out = faitSignOffOutcome(aFait(), {
      [SQE_SIGN_OFF_COLUMN]: "Approved",
      [ENG_SIGN_OFF_COLUMN]: "Approved",
    });
    expect(out.nextStatus).toBeNull();
  });
});

describe("when the auto-advance stands down", () => {
  // Silently overruling a status somebody just picked is worse than not
  // advancing at all.
  it("an explicit Status in the same write wins", () => {
    const out = faitSignOffOutcome(aFait(), {
      [SQE_SIGN_OFF_COLUMN]: "Approved",
      Status: "On Hold",
    });
    expect(out.steps).toEqual([{ kind: "sqe-approved" }]);
    expect(out.nextStatus).toBeNull();
  });

  // Correcting an initials typo on a FAIT that finished last month must not
  // drag it back into somebody's queue.
  it("a closed FAIT is never reopened by editing its sign-offs", () => {
    const out = faitSignOffOutcome(aFait({ status: "Closed", kam: RAY }), {
      [ENG_SIGN_OFF_COLUMN]: "Approved",
    });
    expect(out.steps).toEqual([{ kind: "eng-approved", kamOwed: true }]);
    expect(out.nextStatus).toBeNull();
  });
});
