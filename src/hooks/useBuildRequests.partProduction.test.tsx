import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// The Part Status WRITE is guarded, not only the card's buttons
// (lib/buildRequestPartProduction.ts) — so nothing can mark an unready part
// Ready for Production, or move a part through production, around them.
// Driven through the real hook in mock mode; the signed-in user is NOT an
// admin and NOT the production approver.
// =============================================================================

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  fireFieldChangeAlert: vi.fn(),
  fireBuildRequestPartProductionCompleteAlert: vi.fn(),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Eng Ineer", email: "eng.ineer@altronic-llc.com", lookupId: 5 }),
  useCurrentUserEmails: () => ["eng.ineer@altronic-llc.com"],
}));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => false }));

import { useBuildRequestItems, useUpdateBuildRequestItemFields } from "./useBuildRequests";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function setup() {
  const view = renderHook(() => ({ update: useUpdateBuildRequestItemFields(), items: useBuildRequestItems() }), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(view.result.current.items.data?.length).toBeGreaterThan(0));
  return view;
}

const statusOf = (r: Awaited<ReturnType<typeof setup>>["result"], id: number) =>
  r.current.items.data?.find((i) => i.id === id)?.partStatus;

describe("useUpdateBuildRequestItemFields — part production guard", () => {
  it("refuses Ready for Production on a PCB part whose checklist isn't finished", async () => {
    const { result } = await setup();
    act(() => result.current.update.mutate({ id: 62, fields: { Part_x0020_Status: "Ready for Production" } }));
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(result.current.update.error?.message).toMatch(/checklist item/);
    expect(statusOf(result, 62)).toBe("Review Checklist");
  });

  it("refuses In Production to anyone but the production approver", async () => {
    const { result } = await setup();
    act(() => result.current.update.mutate({ id: 60, fields: { Part_x0020_Status: "In Production" } }));
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(result.current.update.error?.message).toMatch(/Amanda Hoagland/);
  });

  it("lets a ready part be marked Ready for Production", async () => {
    const { result } = await setup();
    act(() => result.current.update.mutate({ id: 45, fields: { Part_x0020_Status: "Ready for Production" } }));
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    await waitFor(() => expect(statusOf(result, 45)).toBe("Ready for Production"));
  });
});
