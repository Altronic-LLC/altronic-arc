import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// The FAIT sign-off chain, wired: SQE approves → the engineer is asked and the
// status advances; the engineer approves → the KAM is asked, but ONLY when one
// is owed; a Failed SQE sign-off goes back to the initiator.
//
// Each "stays quiet" case below starts from a FAIT that ALREADY holds the
// target value. `"SQESignOff" in fields` is PRESENCE, not change — a fixture
// starting anywhere else passes whether the guard exists or not, which is the
// trap this repo has been caught by twice.
//
// The FAIT under test is SEEDED INTO THE CACHE rather than taken out of the
// mock store, because the hook reads the pre-write row from exactly there —
// so each case controls its own starting point and no test depends on what
// the one before it left behind.
// =============================================================================

const fireFaitSignOffRequest = vi.hoisted(() => vi.fn());
const fireFaitSqeFailedAlert = vi.hoisted(() => vi.fn());
const fireFaitWithSqeAlert = vi.hoisted(() => vi.fn());
const fireFaitClosedAlert = vi.hoisted(() => vi.fn());
const fireFaitAssignmentHeadsUp = vi.hoisted(() => vi.fn());
const fireFieldChangeAlert = vi.hoisted(() => vi.fn());
const fireFaitNotifyInitiatorAlert = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireFaitSignOffRequest,
  fireFaitSqeFailedAlert,
  fireFaitWithSqeAlert,
  fireFaitClosedAlert,
  fireFaitAssignmentHeadsUp,
  fireFieldChangeAlert,
  fireFaitNotifyInitiatorAlert,
  fireNewFaitAlert: vi.fn(),
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));

vi.mock("@/api/faits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/faits")>();
  return { ...actual, updateFaitFields: vi.fn(actual.updateFaitFields) };
});

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

const ACTOR = { displayName: "Alex Masgras", email: "alex.masgras@altronic-llc.com" };
vi.mock("./useCurrentUser", () => ({ useCurrentUser: () => ACTOR }));

import { updateFaitFields } from "@/api/faits";
import { useUpdateFaitAssignedEngineer, useUpdateFaitFields, useUpdateFaitKam } from "./useFaits";
import type { Fait, Person } from "@/types/task";

const SARAH: Person = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" };
const JERROD: Person = { displayName: "Jerrod Waldron", email: "jerrod.waldron@altronic-llc.com" };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

/** id 1 is a real row in the mock store, so the write itself still lands. */
function aFait(over: Partial<Fait> = {}, values: Record<string, string> = {}): Fait {
  return {
    id: 1,
    title: "",
    status: "This is with SQE",
    parentProject: null,
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: SARAH,
    assignedEngineer: null,
    kam: null,
    watchers: [SARAH],
    comments: [],
    hasAttachments: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...over,
    // oemImpact defaults to "Yes" — most fixtures here exist to test the
    // KAM half of the chain, and OEMImpact is a real boolean column where
    // blank means No (kamNeeded in lib/faitSignOff.ts), so leaving it unset
    // would hide KAM regardless of what a test sets kam/kamSignOff to.
    values: { sqeSignOff: "", engSignOff: "", kamSignOff: "", oemImpact: "Yes", ...values },
  } as Fait;
}

function setup(fait: Fait) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(["faits"], [fait]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

async function write(fait: Fait, fields: Record<string, unknown>) {
  const { wrapper } = setup(fait);
  const { result } = renderHook(() => useUpdateFaitFields(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ id: fait.id, fields, patch: (f) => f });
  });
}

/** The fields the API was actually PATCHed with. */
function lastPatch(): Record<string, unknown> {
  const calls = vi.mocked(updateFaitFields).mock.calls;
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  fireFaitSignOffRequest.mockClear();
  fireFaitSqeFailedAlert.mockClear();
  fireFaitWithSqeAlert.mockClear();
  fireFaitClosedAlert.mockClear();
  fireFaitAssignmentHeadsUp.mockClear();
  fireFieldChangeAlert.mockClear();
  fireFaitNotifyInitiatorAlert.mockClear();
  vi.mocked(updateFaitFields).mockClear();
});

describe("SQE signs off", () => {
  it("asks the assigned engineer to review it", async () => {
    await write(aFait({ assignedEngineer: JERROD }), { SQESignOff: "Approved" });
    expect(fireFaitSignOffRequest).toHaveBeenCalledTimes(1);
    expect(fireFaitSignOffRequest.mock.calls[0][0]).toMatchObject({
      role: "engineer",
      signer: JERROD,
    });
  });

  // Ray, 2026-09-01: "all sign offs notify watchers".
  it("also passes the FAIT's watchers through to the alert", async () => {
    await write(aFait({ assignedEngineer: JERROD, watchers: [SARAH, RAY] }), {
      SQESignOff: "Approved",
    });
    expect(fireFaitSignOffRequest.mock.calls[0][0]).toMatchObject({ watchers: [SARAH, RAY] });
  });

  // The auto-advance travels in the SAME PATCH as the sign-off that caused
  // it — one write, so the two can never disagree if a second one failed.
  it("advances the status to This is with ENG, in the same write", async () => {
    await write(aFait({ assignedEngineer: JERROD }), { SQESignOff: "Approved" });
    expect(lastPatch()).toEqual({ SQESignOff: "Approved", Status: "This is with ENG" });
  });

  it("still fires the generic status note, so the initiator hears it moved", async () => {
    await write(aFait({ assignedEngineer: JERROD }), { SQESignOff: "Approved" });
    expect(fireFieldChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ fieldLabel: "status", to: "This is with ENG" }),
    );
  });

  // THE GUARD — this fixture is already Approved.
  it("stays quiet when an already-approved sign-off is re-saved", async () => {
    await write(aFait({ assignedEngineer: JERROD }, { sqeSignOff: "Approved" }), {
      SQESignOff: "Approved",
    });
    expect(fireFaitSignOffRequest).not.toHaveBeenCalled();
    expect(lastPatch()).toEqual({ SQESignOff: "Approved" });
  });

  it("falls back to the queue when no engineer is assigned", async () => {
    await write(aFait(), { SQESignOff: "Approved" });
    expect(fireFaitSignOffRequest.mock.calls[0][0]).toMatchObject({
      role: "engineer",
      signer: null,
    });
  });
});

describe("SQE sign-off comes back Failed", () => {
  // ASSUMPTION under test (2026-08-31): Failed goes BACK to the initiator and
  // does not advance the status. See buildFaitSqeFailedEmails.
  it("tells the initiator, and asks the engineer for nothing", async () => {
    await write(aFait({ assignedEngineer: JERROD }), { SQESignOff: "Failed" });
    expect(fireFaitSqeFailedAlert).toHaveBeenCalledTimes(1);
    expect(fireFaitSqeFailedAlert.mock.calls[0][0]).toMatchObject({ initiator: SARAH });
    expect(fireFaitSignOffRequest).not.toHaveBeenCalled();
  });

  it("also passes the FAIT's watchers through", async () => {
    await write(aFait({ assignedEngineer: JERROD, watchers: [SARAH, RAY] }), {
      SQESignOff: "Failed",
    });
    expect(fireFaitSqeFailedAlert.mock.calls[0][0]).toMatchObject({ watchers: [SARAH, RAY] });
  });

  it("does not advance the status", async () => {
    await write(aFait(), { SQESignOff: "Failed" });
    expect(lastPatch()).toEqual({ SQESignOff: "Failed" });
    expect(fireFieldChangeAlert).not.toHaveBeenCalled();
  });

  it("stays quiet when an already-failed sign-off is re-saved", async () => {
    await write(aFait({}, { sqeSignOff: "Failed" }), { SQESignOff: "Failed" });
    expect(fireFaitSqeFailedAlert).not.toHaveBeenCalled();
  });
});

describe("engineering signs off", () => {
  it("asks the KAM when one is owed, and advances to This is with KAM", async () => {
    await write(aFait({ kam: RAY, status: "This is with ENG" }), { EngSignOff: "Approved" });
    expect(fireFaitSignOffRequest.mock.calls[0][0]).toMatchObject({ role: "kam", signer: RAY });
    expect(lastPatch()).toEqual({ EngSignOff: "Approved", Status: "This is with KAM" });
  });

  // kamNeeded gates this. Without it every FAIT with no KAM parks at "This is
  // with KAM" waiting on a signature nobody owes.
  it("asks nobody and parks nothing when no KAM is owed", async () => {
    await write(aFait({ status: "This is with ENG" }), { EngSignOff: "Approved" });
    expect(fireFaitSignOffRequest).not.toHaveBeenCalled();
    expect(lastPatch()).toEqual({ EngSignOff: "Approved" });
  });

  // kamNeeded is more than "is a KAM assigned" — a FAIT signed off before
  // anyone could assign a KAM person still owes the rest of the chain.
  it("counts existing KAM sign-off data as a KAM being owed", async () => {
    await write(aFait({ status: "This is with ENG" }, { kamInitials: "rw" }), {
      EngSignOff: "Approved",
    });
    expect(fireFaitSignOffRequest.mock.calls[0][0]).toMatchObject({ role: "kam", signer: null });
    expect(lastPatch()).toEqual({ EngSignOff: "Approved", Status: "This is with KAM" });
  });

  // THE GUARD — this fixture is already Approved.
  it("stays quiet when an already-approved sign-off is re-saved", async () => {
    await write(aFait({ kam: RAY }, { engSignOff: "Approved" }), { EngSignOff: "Approved" });
    expect(fireFaitSignOffRequest).not.toHaveBeenCalled();
  });
});

describe("the status the chain doesn't set itself", () => {
  it("a FAIT moved to This is with SQE tells the SQE reviewers", async () => {
    await write(aFait({ status: "FAIT Part Received" }), { Status: "This is with SQE" });
    expect(fireFaitWithSqeAlert).toHaveBeenCalledTimes(1);
  });

  it("also passes the FAIT's watchers through", async () => {
    await write(aFait({ status: "FAIT Part Received", watchers: [SARAH, RAY] }), {
      Status: "This is with SQE",
    });
    expect(fireFaitWithSqeAlert.mock.calls[0][0]).toMatchObject({ watchers: [SARAH, RAY] });
  });

  // THE GUARD — this fixture is already there.
  it("stays quiet when the same status is re-saved", async () => {
    await write(aFait({ status: "This is with SQE" }), { Status: "This is with SQE" });
    expect(fireFaitWithSqeAlert).not.toHaveBeenCalled();
  });
});

describe("closing a FAIT", () => {
  // Everyone watching is told by the generic status note; the intake alert
  // covers the queue. Passing the watchers as alreadyNotified is what stops
  // somebody on both lists getting two emails about one close.
  it("hands the closed alert everyone the generic note already reaches", async () => {
    await write(aFait({ status: "This is with KAM", assignedEngineer: JERROD, kam: RAY }), {
      Status: "Closed",
    });
    expect(fireFaitClosedAlert).toHaveBeenCalledTimes(1);
    const { alreadyNotified } = fireFaitClosedAlert.mock.calls[0][0];
    expect(alreadyNotified).toEqual(expect.arrayContaining([SARAH, JERROD, RAY]));
    expect(fireFieldChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ to: "Closed", watchers: [SARAH] }),
    );
  });

  it("stays quiet when an already-closed FAIT is re-saved", async () => {
    await write(aFait({ status: "Closed" }), { Status: "Closed" });
    expect(fireFaitClosedAlert).not.toHaveBeenCalled();
  });

  // Correcting a typo on a FAIT that finished last month must not drag it
  // back into somebody's queue.
  it("editing a closed FAIT's sign-offs never reopens it", async () => {
    await write(aFait({ status: "Closed", kam: RAY }), { EngSignOff: "Approved" });
    expect(lastPatch()).toEqual({ EngSignOff: "Approved" });
  });
});

describe("the assignment heads-up", () => {
  async function assign(
    hook: typeof useUpdateFaitAssignedEngineer,
    fait: Fait,
    person: Person | null,
  ) {
    const { wrapper } = setup(fait);
    const { result } = renderHook(() => hook(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: fait.id, person });
    });
  }

  it("tells an engineer they're on the FAIT", async () => {
    await assign(useUpdateFaitAssignedEngineer, aFait(), JERROD);
    expect(fireFaitAssignmentHeadsUp).toHaveBeenCalledTimes(1);
    expect(fireFaitAssignmentHeadsUp.mock.calls[0][0]).toMatchObject({
      role: "engineer",
      person: JERROD,
    });
  });

  it("tells a KAM the same, with their own role", async () => {
    await assign(useUpdateFaitKam, aFait(), RAY);
    expect(fireFaitAssignmentHeadsUp.mock.calls[0][0]).toMatchObject({ role: "kam", person: RAY });
  });

  // Reassigning tells the new person; re-picking the same one is not news.
  it("stays quiet when the same person is re-picked", async () => {
    await assign(useUpdateFaitAssignedEngineer, aFait({ assignedEngineer: JERROD }), JERROD);
    expect(fireFaitAssignmentHeadsUp).not.toHaveBeenCalled();
  });

  it("stays quiet when the field is cleared", async () => {
    await assign(useUpdateFaitAssignedEngineer, aFait({ assignedEngineer: JERROD }), null);
    expect(fireFaitAssignmentHeadsUp).not.toHaveBeenCalled();
  });
});

// =============================================================================
// "Notify Initiator" — a Sign-off card checkbox with no wiring at all until
// now (Ray, 2026-09-01). Fire-once: only the transition INTO checked sends
// anything. THE GUARD below starts from a fixture where it is ALREADY true —
// the only kind of test that actually exercises a `to !== from` guard, per
// CLAUDE.md's own warning about this exact trap.
// =============================================================================

// A FAIT with every sign-off it owes already Approved — kam: null means no
// KAM is owed, so SQE + Engineering alone is "fully signed off" here.
const FULLY_SIGNED_OFF = { sqeSignOff: "Approved", engSignOff: "Approved" };

describe("the Notify Initiator checkbox", () => {
  // Ray, 2026-09-03: "The Notify Initiator button should change the status
  // to Closed... by pressing it closes the ticket assuming all sign offs
  // are done." Checking it only succeeds — and only then emails anyone —
  // once faitFullySignedOff() says so; see the "refuses" tests below for
  // the incomplete case.
  it("tells the initiator and every watcher, and closes the FAIT, once every sign-off is Approved", async () => {
    await write(aFait({ watchers: [SARAH, RAY] }, FULLY_SIGNED_OFF), { NotifyInitiator: true });
    expect(fireFaitNotifyInitiatorAlert).toHaveBeenCalledTimes(1);
    expect(fireFaitNotifyInitiatorAlert.mock.calls[0][0]).toMatchObject({
      initiator: SARAH,
      watchers: [SARAH, RAY],
    });
    expect(lastPatch()).toMatchObject({ NotifyInitiator: true, Status: "Closed" });
  });

  // THE GUARD. Not fully signed off (SQESignOff blank) — the box must not
  // save, close the FAIT, or email anyone.
  it("refuses to close (or email anyone) when the sign-offs aren't complete", async () => {
    await expect(write(aFait(), { NotifyInitiator: true })).rejects.toThrow(/sign-off/i);
    expect(fireFaitNotifyInitiatorAlert).not.toHaveBeenCalled();
    expect(updateFaitFields).not.toHaveBeenCalled();
  });

  // A KAM is assigned, so one is owed, and it hasn't signed — still refused
  // even though SQE and Engineering are both Approved.
  it("refuses when a KAM is assigned but hasn't signed off yet", async () => {
    await expect(
      write(aFait({ kam: RAY }, FULLY_SIGNED_OFF), { NotifyInitiator: true }),
    ).rejects.toThrow(/sign-off/i);
    expect(fireFaitNotifyInitiatorAlert).not.toHaveBeenCalled();
  });

  // THE GUARD — this fixture already has it checked.
  it("stays quiet when an already-checked box is re-saved", async () => {
    await write(aFait({}, { ...FULLY_SIGNED_OFF, notifyInitiator: "Yes" }), {
      NotifyInitiator: true,
    });
    expect(fireFaitNotifyInitiatorAlert).not.toHaveBeenCalled();
  });

  // Re-saving the Sign-off card with the box already checked and OTHER
  // fields changing must not re-fire it either.
  it("stays quiet when other Sign-off fields change but the box stays checked", async () => {
    await write(aFait({}, { ...FULLY_SIGNED_OFF, notifyInitiator: "Yes" }), {
      NotifyInitiator: true,
      EngInitials: "jw",
    });
    expect(fireFaitNotifyInitiatorAlert).not.toHaveBeenCalled();
  });

  it("does nothing on uncheck — no auto-reset mechanic", async () => {
    await write(aFait({}, { ...FULLY_SIGNED_OFF, notifyInitiator: "Yes" }), {
      NotifyInitiator: false,
    });
    expect(fireFaitNotifyInitiatorAlert).not.toHaveBeenCalled();
  });

  it("does nothing when the field isn't part of the write at all", async () => {
    await write(aFait(), { EngInitials: "jw" });
    expect(fireFaitNotifyInitiatorAlert).not.toHaveBeenCalled();
  });
});
