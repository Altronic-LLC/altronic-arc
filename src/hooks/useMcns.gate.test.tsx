import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// =============================================================================
// The MCN gates are asked INSIDE every mutationFn, against the roles list
// awaited — not only by the buttons. Driven with no screen at all, the way
// useAltronicParts.writes.test.tsx does it: a future screen that forgets to
// grey a button must still be refused.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.email }),
  useCurrentUserEmails: () => [who.email],
}));

import { __resetMcnMockStore, getMcn } from "@/api/mcns";
import { __resetMcnRoleMockStores } from "@/api/mcnRoles";
import { useCreateMcn, useMcnTransition, useUpdateMcnFields } from "./useMcns";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const input = {
  date: null,
  process: "Test",
  priority: "",
  originatedBy: null,
  assignedEngineer: null,
  description: "",
  scope: [],
  distribution: [],
  watchers: [],
};

beforeEach(() => {
  __resetMcnMockStore();
  __resetMcnRoleMockStores();
  who.email = "demo.user@altronic-llc.com";
});

describe("raising", () => {
  it("is refused for somebody not on the team", async () => {
    who.email = "reader@example.com";
    const { result } = renderHook(() => useCreateMcn(), { wrapper });
    await act(() => expect(result.current.mutateAsync(input)).rejects.toThrow(/Only the Manufacturing Team/));
  });

  it("is allowed for a team member", async () => {
    const { result } = renderHook(() => useCreateMcn(), { wrapper });
    const created = await act(() => result.current.mutateAsync(input));
    expect(created.status).toBe("Draft");
    expect(created.mcnNumber).toMatch(/^MCN\d{5}$/);
  });
});

describe("editing", () => {
  it("refuses a content edit on an approved MCN, even from a member", async () => {
    const { result } = renderHook(() => useUpdateMcnFields(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ id: 2, section: "scope", patch: { scope: [] } })).rejects.toThrow(/content is locked/),
    );
  });
});

describe("the workflow", () => {
  it("refuses an approval from somebody who isn't an approver", async () => {
    who.email = "morgan.example@example.com"; // a member, not an approver
    const { result } = renderHook(() => useMcnTransition(), { wrapper });
    await act(() =>
      expect(
        result.current.mutateAsync({ id: 3, action: "approve", distributedTo: [{ displayName: "A", email: "a@example.com" }] }),
      ).rejects.toThrow(/Only an MCN approver/),
    );
    expect((await getMcn(3))?.status).toBe("Submitted");
  });

  it("refuses to approve with nobody to send it to", async () => {
    const { result } = renderHook(() => useMcnTransition(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ id: 3, action: "approve", distributedTo: [] })).rejects.toThrow(/at least one person/),
    );
  });

  it("refuses a rejection with no reason", async () => {
    const { result } = renderHook(() => useMcnTransition(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: 3, action: "reject", reason: "  " })).rejects.toThrow(/reason/));
  });

  it("approves, stamping the approver and keeping the list", async () => {
    const { result } = renderHook(() => useMcnTransition(), { wrapper });
    const updated = await act(() =>
      result.current.mutateAsync({ id: 3, action: "approve", distributedTo: [{ displayName: "A", email: "a@example.com" }] }),
    );
    expect(updated.status).toBe("Approved");
    expect(updated.approvedBy?.email).toBe("demo.user@altronic-llc.com");
    expect(updated.distributedTo.map((p) => p.email)).toEqual(["a@example.com"]);
    expect(updated.comments[0].bodyHtml).toContain("Approved");
  });
});
