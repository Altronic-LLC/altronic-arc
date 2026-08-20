import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { projectIdsFromFields } from "./useEirs";

// =============================================================================
// The EIR triage chain fires at exactly two moments, and not otherwise:
//
//   1. an EIR is created without a project reference   → chase the reviewer
//   2. a project reference lands on one that had none  → chase the assigners
//
// An EIR created WITH a project skips straight to (2). Everything else —
// swapping one project for another, editing an unrelated field — must stay
// quiet, because a work-queue email that arrives when nothing was handed over
// trains people to ignore it.
// =============================================================================

const fireEirTriageAlert = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireEirTriageAlert,
  fireAssigneeChangeAlert: vi.fn(),
  fireChecklistToggleAlert: vi.fn(),
  fireFieldChangeAlert: vi.fn(),
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
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

import { useCreateEir, useEirs, useUpdateEirFields } from "./useEirs";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fireEirTriageAlert.mockClear();
});

/** The single argument the alert was called with. */
function firedWith() {
  return fireEirTriageAlert.mock.calls[0]?.[0] as
    | { stage: string; projectJustAdded?: boolean; projectTitle?: string }
    | undefined;
}

describe("projectIdsFromFields", () => {
  // null and [] mean different things: "not part of this write" versus
  // "the projects were cleared". Conflating them fires on unrelated edits.
  it("is null when the write doesn't touch project references", () => {
    expect(projectIdsFromFields({ Status: "Open" })).toBeNull();
  });

  it("reads the lookupId collection a multi-lookup write sends", () => {
    expect(projectIdsFromFields({ ProjectReferenceLookupId: [274, 501] })).toEqual([274, 501]);
  });

  it("is empty when the projects were cleared", () => {
    expect(projectIdsFromFields({ ProjectReferenceLookupId: [] })).toEqual([]);
  });

  it("ignores junk in the collection", () => {
    expect(projectIdsFromFields({ ProjectReferenceLookupId: [0, -1, "x", 7] })).toEqual([7]);
  });
});

describe("creating an EIR", () => {
  it("chases a project reference when it was raised without one", async () => {
    const { result } = renderHook(() => useCreateEir(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.mutateAsync({ title: "Bearing wear on the test rig" });
    });

    await waitFor(() => expect(fireEirTriageAlert).toHaveBeenCalledTimes(1));
    expect(firedWith()?.stage).toBe("needs-project");
  });

  it("skips the reviewer and chases an engineer when it was raised with one", async () => {
    const { result } = renderHook(() => useCreateEir(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        title: "Bearing wear on the test rig",
        parentProjectLookupId: 501,
      });
    });

    await waitFor(() => expect(fireEirTriageAlert).toHaveBeenCalledTimes(1));
    expect(firedWith()?.stage).toBe("needs-engineer");
    expect(firedWith()?.projectJustAdded).toBe(false);
  });

  it("chases nobody when it was raised fully owned", async () => {
    const { result } = renderHook(() => useCreateEir(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        title: "Bearing wear on the test rig",
        parentProjectLookupId: 501,
        assignedEngineers: [{ displayName: "Sarah Shaffer", email: "sarah@altronic-llc.com" }],
      });
    });

    expect(fireEirTriageAlert).not.toHaveBeenCalled();
  });
});

describe("adding a project reference later", () => {
  /** An EIR from the fixtures with no project and no engineer. */
  async function unownedEir(wrap: ReturnType<typeof wrapper>) {
    const { result } = renderHook(() => useEirs(), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
    return result.current.data!.find(
      (e) => e.parentProjects.length === 0 && e.assignedEngineers.length === 0,
    );
  }

  it("hands the EIR to the assigners", async () => {
    const wrap = wrapper();
    const eir = await unownedEir(wrap);
    expect(eir).toBeDefined();

    const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({
        id: eir!.id,
        fields: { ProjectReferenceLookupId: [501] },
      });
    });

    await waitFor(() => expect(fireEirTriageAlert).toHaveBeenCalledTimes(1));
    expect(firedWith()?.stage).toBe("needs-engineer");
    expect(firedWith()?.projectJustAdded).toBe(true);
  });

  it("stays quiet on an edit that isn't about projects", async () => {
    const wrap = wrapper();
    const eir = await unownedEir(wrap);

    const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ id: eir!.id, fields: { Status: "In Progress" } });
    });

    expect(fireEirTriageAlert).not.toHaveBeenCalled();
  });

  // Swapping one project for another isn't a handover — nobody new is being
  // asked for anything.
  //
  // Driven by setting a project first and then changing it, rather than by
  // picking a fixture that happens to have one: the fixtures with projects
  // also have engineers, so that version of this test passed with the
  // empty-to-set guard deleted. It was proving the wrong guard.
  it("stays quiet when the EIR already had a project", async () => {
    const wrap = wrapper();
    const eir = await unownedEir(wrap);
    const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrap });

    // First project: this IS the handover, and fires.
    await act(async () => {
      await result.current.mutateAsync({
        id: eir!.id,
        fields: { ProjectReferenceLookupId: [501] },
      });
    });
    await waitFor(() => expect(fireEirTriageAlert).toHaveBeenCalledTimes(1));
    fireEirTriageAlert.mockClear();

    // Second project, same EIR, still no engineer: nothing was handed over.
    await act(async () => {
      await result.current.mutateAsync({
        id: eir!.id,
        fields: { ProjectReferenceLookupId: [274] },
      });
    });

    expect(fireEirTriageAlert).not.toHaveBeenCalled();
  });
});
