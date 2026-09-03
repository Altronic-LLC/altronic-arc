import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Closing a FAIT tells the SAME intake list that was told when it was raised
// (Ray, 2026-08-27: "set alerts for the original group when one is closed as
// well as any one assigned"). This is IN ADDITION to the generic status
// alert to watchers + initiator/engineer/KAM, which already covered "anyone
// assigned" — it just had nobody in the engineer/KAM slots to reach until
// useUpdateFaitAssignedEngineer / useUpdateFaitKam existed to fill them.
//
// The guard being tested is `to !== from`, the same trap EIR's status
// alerts already caught: a fixture already AT the target status is the only
// case where deleting the guard would actually fail the test.
// =============================================================================

const fireFaitClosedAlert = vi.hoisted(() => vi.fn());
const fireFieldChangeAlert = vi.hoisted(() => vi.fn());
const fireFaitNotifyInitiatorAlert = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireFaitClosedAlert,
  fireFieldChangeAlert,
  fireFaitNotifyInitiatorAlert,
  fireNewFaitAlert: vi.fn(),
  fireFaitAssignmentHeadsUp: vi.fn(),
  fireFaitSignOffRequest: vi.fn(),
  fireFaitSqeFailedAlert: vi.fn(),
  fireFaitWithSqeAlert: vi.fn(),
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

import {
  useFaits,
  useSetFaitWatchers,
  useUpdateFaitAssignedEngineer,
  useUpdateFaitFields,
  useUpdateFaitKam,
} from "./useFaits";
import type { Fait } from "@/types/task";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fireFaitClosedAlert.mockClear();
  fireFieldChangeAlert.mockClear();
  fireFaitNotifyInitiatorAlert.mockClear();
});

async function aFait(wrap: ReturnType<typeof wrapper>, pick: (f: Fait) => boolean): Promise<Fait> {
  const { result } = renderHook(() => useFaits(), { wrapper: wrap });
  await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  const found = result.current.data!.find(pick);
  if (!found) throw new Error("no fixture FAIT matched — the test cannot mean anything");
  return found;
}

async function setStatus(wrap: ReturnType<typeof wrapper>, fait: Fait, status: string): Promise<void> {
  const { result } = renderHook(() => useUpdateFaitFields(), { wrapper: wrap });
  await act(async () => {
    await result.current.mutateAsync({ id: fait.id, fields: { Status: status }, patch: (f) => f });
  });
}

describe("closing a FAIT", () => {
  it("alerts the same intake list the new-FAIT alert uses", async () => {
    const wrap = wrapper();
    const fait = await aFait(wrap, (f) => f.status !== "Closed");
    await setStatus(wrap, fait, "Closed");

    await waitFor(() => expect(fireFaitClosedAlert).toHaveBeenCalledTimes(1));
    expect(fireFaitClosedAlert.mock.calls[0][0].target).toMatchObject({ kind: "fait", id: fait.id });
  });

  it("still fires the generic status alert alongside it", async () => {
    const wrap = wrapper();
    const fait = await aFait(wrap, (f) => f.status !== "Closed");
    await setStatus(wrap, fait, "Closed");

    await waitFor(() => expect(fireFaitClosedAlert).toHaveBeenCalled());
    expect(fireFieldChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ fieldLabel: "status", to: "Closed" }),
    );
  });

  // THE GUARD. Starting from a status that already isn't Closed passes either
  // way, which proves nothing — this fixture starts AT Closed.
  it("stays quiet when the write re-sends a status the FAIT already had", async () => {
    const wrap = wrapper();
    const already = await aFait(wrap, (f) => f.status === "Closed");
    await setStatus(wrap, already, "Closed");

    await waitFor(() => expect(fireFieldChangeAlert).toHaveBeenCalled());
    expect(fireFaitClosedAlert).not.toHaveBeenCalled();
  });

  it("doesn't fire on a transition to any other status", async () => {
    const wrap = wrapper();
    const fait = await aFait(wrap, (f) => f.status !== "This is with ENG");
    await setStatus(wrap, fait, "This is with ENG");

    await waitFor(() => expect(fireFieldChangeAlert).toHaveBeenCalled());
    expect(fireFaitClosedAlert).not.toHaveBeenCalled();
  });
});

describe("useUpdateFaitAssignedEngineer / useUpdateFaitKam", () => {
  it("assigns an engineer, patching the cache", async () => {
    const wrap = wrapper();
    const { result } = renderHook(
      () => ({ update: useUpdateFaitAssignedEngineer(), list: useFaits() }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const fait = result.current.list.data![0];
    const sarah = { displayName: "Sarah Shaffer", email: "sarah@altronic-llc.com" };

    await act(async () => {
      await result.current.update.mutateAsync({ id: fait.id, person: sarah });
    });

    await waitFor(() =>
      expect(result.current.list.data?.find((f) => f.id === fait.id)?.assignedEngineer?.email).toBe(
        sarah.email,
      ),
    );
  });

  it("assigns a KAM, patching the cache", async () => {
    const wrap = wrapper();
    const { result } = renderHook(() => ({ update: useUpdateFaitKam(), list: useFaits() }), {
      wrapper: wrap,
    });
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const fait = result.current.list.data![0];
    const glenn = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };

    await act(async () => {
      await result.current.update.mutateAsync({ id: fait.id, person: glenn });
    });

    await waitFor(() =>
      expect(result.current.list.data?.find((f) => f.id === fait.id)?.kam?.email).toBe(glenn.email),
    );
  });
});

describe("checking Notify Initiator closes the FAIT", () => {
  // Ray, 2026-09-03: "The Notify Initiator button should change the status
  // to Closed... by pressing it closes the ticket assuming all sign offs
  // are done." Fixture 5 is fully signed off (SQE + Eng + KAM, since one is
  // assigned) but not yet Closed — the one shape needed to prove checking
  // the box actually closes it, not just optimistically shows a status.
  it("closes a FAIT once every sign-off it owes is Approved", async () => {
    const wrap = wrapper();
    const { result } = renderHook(() => ({ update: useUpdateFaitFields(), list: useFaits() }), {
      wrapper: wrap,
    });
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const fait = result.current.list.data!.find((f) => f.id === 5)!;
    // NOT asserting fait.status here: the "closing a FAIT" describe block
    // above mutates whichever FAIT is next non-Closed via a loose `.find()`,
    // against the same shared mock store, and can (harmlessly) reach this
    // fixture too depending on run order. What this test actually proves —
    // that a fully-signed-off FAIT gets moved TO Closed by this write — holds
    // regardless of what its status happened to be walking in.

    await act(async () => {
      await result.current.update.mutateAsync({
        id: fait.id,
        fields: { NotifyInitiator: true },
        patch: (f) => ({ ...f, values: { ...f.values, notifyInitiator: "Yes" } }),
      });
    });

    await waitFor(() => {
      const updated = result.current.list.data!.find((f) => f.id === fait.id)!;
      expect(updated.status).toBe("Closed");
    });
    expect(fireFaitNotifyInitiatorAlert).toHaveBeenCalledTimes(1);
    expect(fireFaitClosedAlert).toHaveBeenCalledTimes(1);
  });

  // THE GUARD. Fixture 6 has SQESignOff: "Pending" and a KAM assigned (so a
  // KAM sign-off is owed) — not fully signed off, which is the only case
  // where deleting `faitFullySignedOff`'s check would actually fail this.
  // Deliberately NOT fixture 2 — the "closing a FAIT" describe block above
  // closes whichever FAIT is next non-Closed, id-agnostic, and can (and did)
  // land on fixture 2 depending on run order against the shared mock store.
  it("refuses to close a FAIT that isn't fully signed off yet", async () => {
    const wrap = wrapper();
    const { result } = renderHook(() => ({ update: useUpdateFaitFields(), list: useFaits() }), {
      wrapper: wrap,
    });
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const fait = result.current.list.data!.find((f) => f.id === 6)!;
    // Not asserting fait.status here either — see the note on the previous
    // test. `faitFullySignedOff` reads the sign-off columns, and nothing in
    // this file ever mutates fixture 6's `sqeSignOff: "Pending"`, so the
    // refusal this test is actually about is guaranteed regardless of what
    // Status drifted to.
    const statusBefore = fait.status;

    await expect(
      act(async () => {
        await result.current.update.mutateAsync({
          id: fait.id,
          fields: { NotifyInitiator: true },
          patch: (f) => ({ ...f, values: { ...f.values, notifyInitiator: "Yes" } }),
        });
      }),
    ).rejects.toThrow(/sign-off/i);

    await waitFor(() => {
      const updated = result.current.list.data!.find((f) => f.id === fait.id)!;
      // Rolled back to whatever it was before — never left showing Closed.
      expect(updated.status).toBe(statusBefore);
      expect(updated.values.notifyInitiator).not.toBe("Yes");
    });
    expect(fireFaitNotifyInitiatorAlert).not.toHaveBeenCalled();
    expect(fireFaitClosedAlert).not.toHaveBeenCalled();
  });

  it("doesn't re-close (or re-email) a FAIT that's already Closed", async () => {
    const wrap = wrapper();
    const { result } = renderHook(() => ({ update: useUpdateFaitFields(), list: useFaits() }), {
      wrapper: wrap,
    });
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    // Fixture 3 has SQE+Eng Approved and no KAM assigned — fully signed off —
    // but its Status can drift under other tests in this file (the "closing
    // a FAIT" block above can move it off Closed via a loose `.find()`). So
    // force it to Closed here rather than trusting the fixture's starting
    // value, which is what this test is actually about: an ALREADY-closed
    // FAIT must not be re-closed or re-emailed.
    await act(async () => {
      await result.current.update.mutateAsync({
        id: 3,
        fields: { Status: "Closed" },
        patch: (f) => ({ ...f, status: "Closed" }),
      });
    });
    fireFaitClosedAlert.mockClear();
    fireFaitNotifyInitiatorAlert.mockClear();

    await act(async () => {
      await result.current.update.mutateAsync({
        id: 3,
        fields: { NotifyInitiator: true },
        patch: (f) => ({ ...f, values: { ...f.values, notifyInitiator: "Yes" } }),
      });
    });

    await waitFor(() => {
      const updated = result.current.list.data!.find((f) => f.id === 3)!;
      expect(updated.values.notifyInitiator).toBe("Yes");
    });
    // Still fires the initiator email once (the box itself is a genuine
    // fire-once transition) but must not send a SECOND close alert to the
    // intake list for a FAIT that was already closed.
    expect(fireFaitClosedAlert).not.toHaveBeenCalled();
  });
});

describe("useSetFaitWatchers — the initiator is always folded back in", () => {
  // Defence in depth alongside FaitDetailView's own refusal to uncheck the
  // initiator (Ray, 2026-09-03: "confirm the initiator is always on the
  // watchers list"). Even a caller that sends a watcher list with NO
  // initiator in it — bypassing the picker's own guard entirely — must not
  // be able to drop them from what actually gets written.
  it("re-adds the initiator even when the caller's list omits them", async () => {
    const wrap = wrapper();
    const fait = await aFait(wrap, (f) => !!f.initiator);
    const { result } = renderHook(
      () => ({ setWatchers: useSetFaitWatchers(), list: useFaits() }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    const someoneElse = { displayName: "Someone Else", email: "someone.else@altronic-llc.com" };

    await act(async () => {
      await result.current.setWatchers.mutateAsync({
        id: fait.id,
        people: [someoneElse], // deliberately NOT including fait.initiator
        initiator: fait.initiator,
      });
    });

    await waitFor(() => {
      const updated = result.current.list.data!.find((f) => f.id === fait.id)!;
      expect(updated.watchers.some((w) => w.email === fait.initiator!.email)).toBe(true);
      expect(updated.watchers.some((w) => w.email === someoneElse.email)).toBe(true);
    });
  });

  it("still allows clearing watchers down to just the initiator", async () => {
    const wrap = wrapper();
    const fait = await aFait(wrap, (f) => !!f.initiator && f.watchers.length > 1);
    const { result } = renderHook(
      () => ({ setWatchers: useSetFaitWatchers(), list: useFaits() }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.setWatchers.mutateAsync({
        id: fait.id,
        people: [],
        initiator: fait.initiator,
      });
    });

    await waitFor(() => {
      const updated = result.current.list.data!.find((f) => f.id === fait.id)!;
      expect(updated.watchers).toHaveLength(1);
      expect(updated.watchers[0].email).toBe(fait.initiator!.email);
    });
  });
});
