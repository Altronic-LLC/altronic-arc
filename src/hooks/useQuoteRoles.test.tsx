import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

// =============================================================================
// Quote Roles hooks, in mock mode. Who is signed in is a hoisted variable, so
// each test can be the manager, the quoter, the viewer or an ARC admin with
// no quote role. The API module is wrapped in call-through spies, so a refused
// write can be shown to have reached NOTHING.
// =============================================================================

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));
vi.mock("@/api/quoteRoles", async (orig) => {
  const a = await orig<typeof import("@/api/quoteRoles")>();
  return {
    ...a,
    listQuoteRoleEntries: vi.fn(a.listQuoteRoleEntries),
    createQuoteRoleEntry: vi.fn(a.createQuoteRoleEntry),
    updateQuoteRoleEntry: vi.fn(a.updateQuoteRoleEntry),
    deleteQuoteRoleEntry: vi.fn(a.deleteQuoteRoleEntry),
  };
});

import * as api from "@/api/quoteRoles";
import {
  QUOTE_ROLES_KEY,
  resolveQuoteAccess,
  useCreateQuoteRoleEntry,
  useDeleteQuoteRoleEntry,
  useMyQuoteAccess,
  useResolveQuoteAccess,
  useUpdateQuoteRoleEntry,
} from "./useQuoteRoles";

const MANAGER = ["demo.user@altronic-llc.com"];
const QUOTER = ["katie.fleming@altronic-llc.com"];
const VIEWER = ["brandon.mirto@altronic-llc.com"];
/** A bootstrap ARC admin with no quote role. */
const ARC_ADMIN = ["ray.white@altronic-llc.com"];
const NOBODY = ["someone.else@altronic-llc.com"];

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  __resetQuoteMockStores();
  who.emails = MANAGER;
  vi.mocked(api.listQuoteRoleEntries).mockClear();
  vi.mocked(api.createQuoteRoleEntry).mockClear();
  vi.mocked(api.updateQuoteRoleEntry).mockClear();
  vi.mocked(api.deleteQuoteRoleEntry).mockClear();
});

describe("useMyQuoteAccess", () => {
  it("is resolving while the roles list loads, then gives a manager every right", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyQuoteAccess(), { wrapper });
    expect(result.current.resolving).toBe(true);
    expect(result.current.rights.canAccess).toBe(false);
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.configured).toBe(true);
    expect(result.current.failed).toBe(false);
    expect(Object.values(result.current.rights).every(Boolean)).toBe(true);
  });

  it("is resolving while the identity has no address yet", async () => {
    who.emails = [];
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyQuoteAccess(), { wrapper });
    await waitFor(() => expect(vi.mocked(api.listQuoteRoleEntries)).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.resolving).toBe(true);
  });

  it("matches case-insensitively against EVERY address the account carries", async () => {
    who.emails = ["k.fleming@other-tenant.com", "Katie.Fleming@Altronic-LLC.com"];
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyQuoteAccess(), { wrapper });
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.rights.canEdit).toBe(true);
    expect(result.current.rights.canSetOutcome).toBe(false);
  });

  it("gives a viewer access but no cost and no edit", async () => {
    who.emails = VIEWER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyQuoteAccess(), { wrapper });
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.rights.canAccess).toBe(true);
    expect(result.current.rights.canSeeCost).toBe(false);
    expect(result.current.rights.canEdit).toBe(false);
  });

  it("gives an ARC admin with no quote role ONLY the roles-list right", async () => {
    who.emails = ARC_ADMIN;
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyQuoteAccess(), { wrapper });
    await waitFor(() => expect(result.current.resolving).toBe(false));
    const { canManageRoles, ...rest } = result.current.rights;
    expect(canManageRoles).toBe(true);
    expect(Object.values(rest).some(Boolean)).toBe(false);
  });

  it("gives somebody not on the list nothing", async () => {
    who.emails = NOBODY;
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyQuoteAccess(), { wrapper });
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(Object.values(result.current.rights).some(Boolean)).toBe(false);
  });

  it("reports failed when the roles list can't be read", async () => {
    vi.mocked(api.listQuoteRoleEntries).mockRejectedValueOnce(new Error("Graph 503"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyQuoteAccess(), { wrapper });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.resolving).toBe(false);
    expect(result.current.rights.canAccess).toBe(false);
  });
});

describe("resolveQuoteAccess", () => {
  it("awaits the list (no cached data needed) and is never resolving", async () => {
    const { qc } = setup();
    const access = await resolveQuoteAccess(qc, QUOTER);
    expect(access.resolving).toBe(false);
    expect(access.rights.canCreate).toBe(true);
    expect(qc.getQueryData(QUOTE_ROLES_KEY)).toBeDefined();
  });

  it("a failed roles READ refuses rather than grants", async () => {
    vi.mocked(api.listQuoteRoleEntries).mockRejectedValueOnce(new Error("throttled"));
    const { qc } = setup();
    const access = await resolveQuoteAccess(qc, MANAGER);
    expect(access.failed).toBe(true);
    expect(access.rights.canManageRoles).toBe(false);
  });

  it("the hook form reads the CURRENT addresses", async () => {
    who.emails = VIEWER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useResolveQuoteAccess(), { wrapper });
    const access = await act(() => result.current());
    expect(access.rights.canAccess).toBe(true);
    expect(access.rights.canEdit).toBe(false);
  });
});

describe("roles CRUD — manager or ARC admin, asked inside the mutationFn", () => {
  const input = { email: "new.person@altronic-llc.com", displayName: "New Person", roles: ["viewer" as const], note: "" };

  it("refuses a quoter BEFORE any write", async () => {
    who.emails = QUOTER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteRoleEntry(), { wrapper });
    await act(() => expect(result.current.mutateAsync(input)).rejects.toThrow(/quote manager or an ARC admin/));
    expect(api.createQuoteRoleEntry).not.toHaveBeenCalled();
  });

  it("lets a manager add someone", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteRoleEntry(), { wrapper });
    const created = await act(() => result.current.mutateAsync(input));
    expect(created.email).toBe("new.person@altronic-llc.com");
    expect(api.createQuoteRoleEntry).toHaveBeenCalledTimes(1);
  });

  it("lets an ARC admin with no quote role add someone", async () => {
    who.emails = ARC_ADMIN;
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteRoleEntry(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    expect(api.createQuoteRoleEntry).toHaveBeenCalledTimes(1);
  });

  it("refuses a viewer's update BEFORE any write, and allows a manager's", async () => {
    who.emails = VIEWER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateQuoteRoleEntry(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: 3, roles: ["manager"] })).rejects.toThrow());
    expect(api.updateQuoteRoleEntry).not.toHaveBeenCalled();

    who.emails = MANAGER;
    const second = setup();
    const { result: r2 } = renderHook(() => useUpdateQuoteRoleEntry(), { wrapper: second.wrapper });
    await act(() => r2.current.mutateAsync({ id: 3, roles: ["quoter"] }));
    expect(api.updateQuoteRoleEntry).toHaveBeenCalledWith({ id: 3, roles: ["quoter"] });
  });

  it("refuses a quoter's delete BEFORE any write, and allows a manager's", async () => {
    who.emails = QUOTER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeleteQuoteRoleEntry(), { wrapper });
    await act(() => expect(result.current.mutateAsync(3)).rejects.toThrow());
    expect(api.deleteQuoteRoleEntry).not.toHaveBeenCalled();

    who.emails = MANAGER;
    const second = setup();
    const { result: r2 } = renderHook(() => useDeleteQuoteRoleEntry(), { wrapper: second.wrapper });
    await act(() => r2.current.mutateAsync(3));
    expect(api.deleteQuoteRoleEntry).toHaveBeenCalledWith(3);
  });
});
