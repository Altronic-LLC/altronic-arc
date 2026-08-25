import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// The two status transitions that raise a work request (Ray, 2026-08-25):
//
//   → "Response Accepted"     : tell the configured pair to close the EIR
//   → "Response Not Accepted" : tell the assigned engineer(s) to revisit
//
// Both fire from the ONE hook that can write Status (useUpdateEirFields), so
// they cover the sidebar picker, the board drag and the linked-task completion
// path alike.
//
// The guard being tested is `to !== from`. `"Status" in fields` is PRESENCE,
// not change: a write that re-sends the status a record already has would
// otherwise email people about a transition that never happened.
// =============================================================================

const fireEirResponseAcceptedAlert = vi.hoisted(() => vi.fn());
const fireEirResponseNotAcceptedAlert = vi.hoisted(() => vi.fn());
const fireFieldChangeAlert = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireEirResponseAcceptedAlert,
  fireEirResponseNotAcceptedAlert,
  fireFieldChangeAlert,
  fireAssigneeChangeAlert: vi.fn(),
  fireChecklistToggleAlert: vi.fn(),
  fireEirTriageAlert: vi.fn(),
  firePromotionAlert: vi.fn(),
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Sheila Horn",
    email: "sheila.horn@altronic-llc.com",
    lookupId: 22,
  }),
}));

import { useEirs, useUpdateEirFields } from "./useEirs";
import type { Eir, EirStatus } from "@/types/task";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fireEirResponseAcceptedAlert.mockClear();
  fireEirResponseNotAcceptedAlert.mockClear();
  fireFieldChangeAlert.mockClear();
});

/** Load the fixtures and hand back an EIR matching a predicate. */
async function anEir(
  wrap: ReturnType<typeof wrapper>,
  pick: (e: Eir) => boolean,
): Promise<Eir> {
  const { result } = renderHook(() => useEirs(), { wrapper: wrap });
  await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  const found = result.current.data!.find(pick);
  if (!found) throw new Error("no fixture EIR matched — the test cannot mean anything");
  return found;
}

async function setStatus(
  wrap: ReturnType<typeof wrapper>,
  eir: Eir,
  status: EirStatus,
): Promise<void> {
  const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrap });
  await act(async () => {
    await result.current.mutateAsync({ id: eir.id, fields: { Status: status } });
  });
}

describe("moving an EIR to Response Accepted", () => {
  it("asks the configured pair to close it", async () => {
    const wrap = wrapper();
    const eir = await anEir(wrap, (e) => e.status !== "Response Accepted");
    await setStatus(wrap, eir, "Response Accepted");

    await waitFor(() => expect(fireEirResponseAcceptedAlert).toHaveBeenCalledTimes(1));
    const args = fireEirResponseAcceptedAlert.mock.calls[0][0];
    expect(args.target).toMatchObject({ kind: "eir", id: eir.id });
    expect(args.actor.email).toBe("sheila.horn@altronic-llc.com");
  });

  // THE GUARD. A fixture already AT the status is the only way this test can
  // fail when `to !== from` is deleted — starting from another status passes
  // either way, which is the trap this whole file exists to avoid.
  it("stays quiet when the write re-sends the status it already had", async () => {
    const wrap = wrapper();
    const already = await anEir(wrap, (e) => e.status === "Response Accepted");
    await setStatus(wrap, already, "Response Accepted");

    await waitFor(() => expect(fireFieldChangeAlert).toHaveBeenCalled());
    expect(fireEirResponseAcceptedAlert).not.toHaveBeenCalled();
  });

  // Asserting the two new alerts stay silent here proves nothing: with the
  // `"Status" in fields` check deleted, `to` becomes "" — which matches neither
  // trigger, so those assertions hold either way. The GENERIC status alert is
  // what the presence check actually guards, so that is what's asserted.
  it("stays quiet on a write that doesn't touch Status", async () => {
    const wrap = wrapper();
    const eir = await anEir(wrap, () => true);
    const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: eir.id, fields: { BuyerCode: "AB" } });
    });
    expect(fireFieldChangeAlert).not.toHaveBeenCalled();
    expect(fireEirResponseAcceptedAlert).not.toHaveBeenCalled();
    expect(fireEirResponseNotAcceptedAlert).not.toHaveBeenCalled();
  });

  it("doesn't also fire the not-accepted alert", async () => {
    const wrap = wrapper();
    const eir = await anEir(wrap, (e) => e.status !== "Response Accepted");
    await setStatus(wrap, eir, "Response Accepted");
    await waitFor(() => expect(fireEirResponseAcceptedAlert).toHaveBeenCalled());
    expect(fireEirResponseNotAcceptedAlert).not.toHaveBeenCalled();
  });
});

describe("moving an EIR to Response Not Accepted", () => {
  it("asks the assigned engineers to revisit", async () => {
    const wrap = wrapper();
    const eir = await anEir(
      wrap,
      (e) => e.status !== "Response Not Accepted" && e.assignedEngineers.length > 0,
    );
    await setStatus(wrap, eir, "Response Not Accepted");

    await waitFor(() => expect(fireEirResponseNotAcceptedAlert).toHaveBeenCalledTimes(1));
    const args = fireEirResponseNotAcceptedAlert.mock.calls[0][0];
    // The engineers come off the PRE-write snapshot, so they're the people who
    // were assigned when the response was rejected.
    expect(args.engineers.map((p: { email?: string }) => p.email)).toEqual(
      eir.assignedEngineers.map((p) => p.email),
    );
  });

  // An EIR with nobody assigned is a real state — the fallback to the triage
  // assigners is decided inside the api wrapper, but the hook must still fire.
  it("still fires when no engineer is assigned", async () => {
    const wrap = wrapper();
    const eir = await anEir(
      wrap,
      (e) => e.status !== "Response Not Accepted" && e.assignedEngineers.length === 0,
    );
    await setStatus(wrap, eir, "Response Not Accepted");

    await waitFor(() => expect(fireEirResponseNotAcceptedAlert).toHaveBeenCalledTimes(1));
    expect(fireEirResponseNotAcceptedAlert.mock.calls[0][0].engineers).toEqual([]);
  });

  it("stays quiet when the status was already Response Not Accepted", async () => {
    const wrap = wrapper();
    const already = await anEir(wrap, (e) => e.status === "Response Not Accepted");
    await setStatus(wrap, already, "Response Not Accepted");

    await waitFor(() => expect(fireFieldChangeAlert).toHaveBeenCalled());
    expect(fireEirResponseNotAcceptedAlert).not.toHaveBeenCalled();
  });

  // "EIR Not Accepted" is a different status: the request was rejected, not the
  // engineer's answer, so "give a more detailed response" would be wrong.
  it("does not fire on EIR Not Accepted", async () => {
    const wrap = wrapper();
    const eir = await anEir(wrap, (e) => e.status !== "EIR Not Accepted");
    await setStatus(wrap, eir, "EIR Not Accepted");

    await waitFor(() => expect(fireFieldChangeAlert).toHaveBeenCalled());
    expect(fireEirResponseNotAcceptedAlert).not.toHaveBeenCalled();
    expect(fireEirResponseAcceptedAlert).not.toHaveBeenCalled();
  });
});

describe("the generic status note", () => {
  // Deliberately NOT suppressed when a specific alert fires: the specific one
  // goes only to the people who must act, so dropping this would stop the
  // reporter and watchers hearing that the EIR moved at all.
  it("still goes out alongside the specific alert", async () => {
    const wrap = wrapper();
    const eir = await anEir(wrap, (e) => e.status !== "Response Accepted");
    await setStatus(wrap, eir, "Response Accepted");

    await waitFor(() => expect(fireEirResponseAcceptedAlert).toHaveBeenCalled());
    expect(fireFieldChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ fieldLabel: "status", to: "Response Accepted" }),
    );
  });
});
