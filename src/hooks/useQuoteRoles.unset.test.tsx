import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Real mode with NO Quote Roles list configured: unset means NO ACCESS —
// nobody holds a role, nothing is resolving, and every write refuses. Forced
// here rather than read from the environment, so this holds on a clone with
// no .env.local and in CI alike.
// =============================================================================

vi.mock("@/api/config", async (orig) => ({
  ...(await orig<typeof import("@/api/config")>()),
  USE_MOCK: false,
  SP_QUOTE_ROLES_LIST_ID: undefined,
}));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => []) }));
const graph = vi.hoisted(() => ({ graphFetch: vi.fn(), graphFetchAll: vi.fn() }));
vi.mock("@/api/graph", () => graph);
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 0 }),
  useCurrentUserEmails: () => ["ray.white@altronic-llc.com"],
}));

import { resolveQuoteAccess, useCreateQuoteRoleEntry, useMyQuoteAccess } from "./useQuoteRoles";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  graph.graphFetch.mockClear();
  graph.graphFetchAll.mockClear();
});

describe("Quote Roles list not configured (real mode)", () => {
  it("gives no access, is not resolving, and says it isn't configured — even to an ARC admin", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyQuoteAccess(), { wrapper });
    await waitFor(() => expect(result.current.configured).toBe(false));
    expect(result.current.resolving).toBe(false);
    expect(result.current.failed).toBe(false);
    expect(Object.values(result.current.rights).some(Boolean)).toBe(false);
  });

  it("resolves to no rights inside a mutationFn", async () => {
    const { qc } = setup();
    const access = await resolveQuoteAccess(qc, ["ray.white@altronic-llc.com"]);
    expect(access.rights.canManageRoles).toBe(false);
    expect(access.failed).toBe(false);
  });

  it("refuses a roles write without touching Graph", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQuoteRoleEntry(), { wrapper });
    await act(() =>
      expect(
        result.current.mutateAsync({ email: "a@altronic-llc.com", displayName: "A", roles: ["viewer"], note: "" }),
      ).rejects.toThrow(),
    );
    expect(graph.graphFetch).not.toHaveBeenCalled();
  });
});
