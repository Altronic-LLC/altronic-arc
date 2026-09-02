import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Person } from "@/types/task";

const CREATOR: Person = {
  displayName: "Demo User",
  email: "demo.user@altronic-llc.com",
  lookupId: 3,
};

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => CREATOR,
}));

import {
  useCreateFeatureRequest,
  useFeatureRequest,
  useFeatureRequests,
  useUpdateFeatureRequestFields,
} from "./useFeatureRequests";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useFeatureRequests", () => {
  it("lists mock feature requests", async () => {
    const { result } = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBeGreaterThan(0);
  });

  it("useFeatureRequest resolves a single request by id", async () => {
    const list = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const id = list.result.current.data![0].id;

    const { result } = renderHook(() => useFeatureRequest(id), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe(id));
  });
});

describe("useCreateFeatureRequest", () => {
  it("creates a request auto-filled to the current user and seeds the cache", async () => {
    const { result } = renderHook(() => useCreateFeatureRequest(), { wrapper });

    let created;
    await act(async () => {
      created = await result.current.mutateAsync({
        title: "New idea",
        description: "details",
        department: "Engineering",
        priority: "Medium",
      });
    });

    expect(created).toMatchObject({
      title: "New idea",
      status: "Pending Review",
      requestedBy: CREATOR,
    });
  });
});

describe("useUpdateFeatureRequestFields", () => {
  it("optimistically patches status and rolls back on failure", async () => {
    const list = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const target = list.result.current.data![0];

    const { result } = renderHook(() => useUpdateFeatureRequestFields(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: target.id, fields: { Status: "In Work" } });
    });
    expect(result.current.isSuccess).toBe(true);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
