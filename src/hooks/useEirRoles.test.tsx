import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Mutable state the mocks read, flipped per test.
const state = vi.hoisted(() => ({
  enforced: true as boolean,
  user: { displayName: "Demo", email: "demo.user@altronic-llc.com" } as {
    displayName: string;
    email: string;
  },
  /**
   * Extra addresses the account carries beyond the one it signs in with.
   * Real accounts have several and they are allowed to disagree — which is
   * what broke Steven Pirko's engineer role (2026-08-20).
   */
  extraEmails: [] as string[],
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => state.user,
  useCurrentUserEmails: () =>
    [state.user.email, ...state.extraEmails]
      .map((e) => (e ?? "").trim().toLowerCase())
      .filter(Boolean),
}));

// EIR_ROLES_ENFORCED is a module constant, so toggle it via a getter on the
// mocked config module (named imports are live bindings to these getters).
vi.mock("@/api/config", () => ({
  get EIR_ROLES_ENFORCED() {
    return state.enforced;
  },
  USE_MOCK: true,
  SP_SITE_ID: "site",
  SP_EIR_ROLES_LIST_ID: undefined,
  GRAPH_BASE: "https://graph.microsoft.com/v1.0",
}));

import { useMyEirRoles } from "./useEirRoles";
import type { EirRoleEntry } from "@/types/task";

const ROLES_DATA: EirRoleEntry[] = [
  { id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo", roles: ["engineer", "supply chain"], note: "" },
  { id: 2, email: "eng.only@altronic-llc.com", displayName: "Eng", roles: ["engineer"], note: "" },
  { id: 3, email: "sc.only@altronic-llc.com", displayName: "SC", roles: ["supply chain"], note: "" },
];

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  // Seed fresh so the query resolves immediately without hitting the API.
  qc.setQueryData(["eir-roles", "list"], ROLES_DATA);
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  state.enforced = true;
  state.user = { displayName: "Demo", email: "demo.user@altronic-llc.com" };
  state.extraEmails = [];
});

describe("useMyEirRoles", () => {
  it("returns both roles for a user tagged engineer + supply chain", () => {
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current).toEqual({ isEngineer: true, isSupplyChain: true, enforced: true });
  });

  it("returns engineer only", () => {
    state.user = { displayName: "Eng", email: "eng.only@altronic-llc.com" };
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current).toEqual({ isEngineer: true, isSupplyChain: false, enforced: true });
  });

  it("returns supply chain only", () => {
    state.user = { displayName: "SC", email: "sc.only@altronic-llc.com" };
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current).toEqual({ isEngineer: false, isSupplyChain: true, enforced: true });
  });

  it("returns no roles for an untagged user (case-insensitive match)", () => {
    state.user = { displayName: "Eng", email: "ENG.ONLY@altronic-llc.com" };
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    // Still matches case-insensitively.
    expect(result.current.isEngineer).toBe(true);
  });

  it("returns no roles for an unknown user", () => {
    state.user = { displayName: "Nobody", email: "nobody@altronic-llc.com" };
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current).toEqual({ isEngineer: false, isSupplyChain: false, enforced: true });
  });

  it("returns no roles when the user has no email", () => {
    state.user = { displayName: "Anon", email: "" };
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current).toEqual({ isEngineer: false, isSupplyChain: false, enforced: true });
  });

  // THE ONE THAT MATTERED. Steven Pirko was tagged `engineer` on the roles
  // list and every gated field stayed read-only. The lookup was already on
  // email rather than display name — but on `account.username`, the name he
  // SIGNS IN with, which is allowed to differ from the mailbox the roles list
  // holds. In a tenant assembled from two companies, it does.
  it("matches when the sign-in name is on a different domain to the mailbox", () => {
    state.user = { displayName: "Eng", email: "eng.only@coopermachineryservices.com" };
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current.isEngineer).toBe(true);
  });

  it("matches on a secondary address when the primary one doesn't fit", () => {
    state.user = { displayName: "Eng", email: "e.pirko@coopermachineryservices.com" };
    state.extraEmails = ["eng.only@altronic-llc.com"];
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current.isEngineer).toBe(true);
  });

  // Matching a whole different person's local part would be worse than the bug.
  it("still refuses someone who isn't on the list at all", () => {
    state.user = { displayName: "Nobody", email: "nobody@coopermachineryservices.com" };
    state.extraEmails = ["nobody.else@altronic-llc.com"];
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current).toEqual({ isEngineer: false, isSupplyChain: false, enforced: true });
  });

  // Gating on a name is how the wrong person gets access.
  it("never matches on the display name", () => {
    state.user = { displayName: "eng.only", email: "" };
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current.isEngineer).toBe(false);
  });

  it("is not enforced when the roles list is unconfigured", () => {
    state.enforced = false;
    const { result } = renderHook(() => useMyEirRoles(), { wrapper: makeWrapper() });
    expect(result.current).toEqual({ isEngineer: false, isSupplyChain: false, enforced: false });
  });
});
