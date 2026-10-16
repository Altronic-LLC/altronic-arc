import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetPricingMockStores, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// The PREVIEW switch in front of Sales Pricing (Ray, 2026-10-13). While
// PRICING_LIVE is off, only PRICING_PREVIEW_USERS get in — whatever the roles
// list says. Config is mocked so this doesn't depend on a VITE_* var.
// =============================================================================

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return { ...actual, PRICING_LIVE: false, PRICING_PREVIEW_USERS: "ray.white@altronic-llc.com" };
});

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));

import { resolvePricingAccess, useMyPricingAccess } from "./usePricingRoles";
import { NO_PRICING_RIGHTS } from "@/lib/pricingRoles";

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
  __resetPricingMockStores();
  // Ray, as a pricing MANAGER — the one person the preview lets in.
  pricingMockDb.roles.push({
    id: 99,
    email: "ray.white@altronic-llc.com",
    displayName: "Ray White",
    roles: ["manager"],
    note: "",
  });
});

describe("resolvePricingAccess under the preview switch", () => {
  it("gives a pricing ADMIN who isn't on the preview list NO rights", async () => {
    const { qc } = setup();
    const access = await resolvePricingAccess(qc, ["demo.user@altronic-llc.com"]);
    expect(access.rights).toEqual(NO_PRICING_RIGHTS);
    expect(access.failed).toBe(false);
  });

  it("gives the preview user his role's rights", async () => {
    const { qc } = setup();
    const access = await resolvePricingAccess(qc, ["Ray.White@altronic-llc.com"]);
    expect(access.rights.canAccess).toBe(true);
    expect(access.rights.canPrice).toBe(true);
    expect(access.rights.canSeeCost).toBe(true);
    expect(access.rights.canAddToSap).toBe(false); // manager, not admin
  });
});

describe("useMyPricingAccess under the preview switch", () => {
  it("a pricing admin not on the preview list: no rights, inPreviewOnly true, never resolving", () => {
    who.emails = ["demo.user@altronic-llc.com"];
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyPricingAccess(), { wrapper });
    expect(result.current.rights).toEqual(NO_PRICING_RIGHTS);
    expect(result.current.inPreviewOnly).toBe(true);
    expect(result.current.resolving).toBe(false);
  });

  it("the preview user gets his role's rights", async () => {
    who.emails = ["ray.white@altronic-llc.com"];
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyPricingAccess(), { wrapper });
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.inPreviewOnly).toBe(false);
    expect(result.current.rights.canPrice).toBe(true);
    expect(result.current.rights.canAddToSap).toBe(false);
    // A bootstrap ARC admin may manage the roles list.
    expect(result.current.rights.canManageRoles).toBe(true);
  });
});
