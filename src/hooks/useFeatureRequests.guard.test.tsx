import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// ARC Feature Requests are OPEN to any signed-in user — no admin gate on
// create, comment, or status/priority/department/target-version changes
// (unlike Admins, EIR Roles, CSA Listings, Quick Links, Maintenance Roles,
// etc., which all re-check useIsAdmin/useAdminAccess inside their
// mutationFn). This guard makes sure that stays true: it deliberately
// mocks NEITHER useIsAdmin NOR useAdminAccess, so if a future edit added an
// admin check to any mutation here, that mutation would throw
// "useIsAdmin is not a function" (or similar) rather than silently passing.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Rank And File",
    email: "rank.and.file@altronic-llc.com",
    lookupId: 0,
  }),
}));

import {
  useAddFeatureRequestComment,
  useCreateFeatureRequest,
  useFeatureRequests,
  useUpdateFeatureRequestFields,
} from "./useFeatureRequests";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("no admin gate on ARC Feature Requests", () => {
  it("a non-admin user can create a request", async () => {
    const { result } = renderHook(() => useCreateFeatureRequest(), { wrapper });
    let created: unknown;
    await act(async () => {
      created = await result.current.mutateAsync({
        title: "Anyone can ask for this",
        description: "",
        department: null,
        priority: null,
      });
    });
    expect((created as { id: number }).id).toBeGreaterThan(0);
  });

  it("a non-admin user can change status/priority/department/target version", async () => {
    const list = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const target = list.result.current.data![0];

    const { result } = renderHook(() => useUpdateFeatureRequestFields(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: target.id,
        fields: { Status: "In Work", Priority: "High", Department: "Panels", TargetVersion: "v1.0.0" },
      });
    });
    expect(result.current.isSuccess).toBe(true);
  });

  it("a non-admin user can post a comment", async () => {
    const list = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const target = list.result.current.data![0];

    const { result } = renderHook(() => useAddFeatureRequestComment(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: target.id,
        comment: {
          authorName: "Rank And File",
          authorEmail: "rank.and.file@altronic-llc.com",
          bodyHtml: "<p>hi</p>",
        },
      });
    });
    expect(result.current.isSuccess).toBe(true);
  });
});

describe("the API module itself has no delete", () => {
  it("exports nothing matching /delete|remove/", async () => {
    const mod = await import("@/api/featureRequests");
    const suspicious = Object.keys(mod).filter((k) => /delete|remove/i.test(k));
    expect(suspicious).toEqual([]);
  });
});
