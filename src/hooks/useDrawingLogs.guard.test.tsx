import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DrawingLogInput } from "@/types/task";

// The view hides the write controls from non-admins; these guards make sure no
// other call path can write either. Mirrors useCsaListings.guard.test.tsx.

const mocks = vi.hoisted(() => ({ isAdmin: true }));

vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => mocks.isAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.isAdmin, isResolving: false }),
}));
// Entries are shaped as the real API returns them — `kind` and `values` — so the
// hooks' success toasts (which label the entry) behave as they do in the app.
// Built inside vi.hoisted because a vi.mock factory is lifted above plain consts.
const fake = vi.hoisted(() => ({
  entry: { id: 1, kind: "ccc", values: { drawingNo: "999 000" }, changes: [] },
}));

vi.mock("@/api/drawingLogs", () => ({
  DRAWING_LOGS: { ccc: { label: "CCC Drawings" } },
  listDrawingLog: vi.fn().mockResolvedValue([]),
  createDrawingLogEntry: vi.fn().mockResolvedValue(fake.entry),
  updateDrawingLogEntry: vi.fn().mockResolvedValue(fake.entry),
  appendDrawingChange: vi.fn().mockResolvedValue(fake.entry),
  deleteDrawingLogEntry: vi.fn().mockResolvedValue(undefined),
}));

import {
  useAppendDrawingChange,
  useCreateDrawingLogEntry,
  useDeleteDrawingLogEntry,
  useUpdateDrawingLogEntry,
} from "./useDrawingLogs";
import {
  appendDrawingChange,
  createDrawingLogEntry,
  deleteDrawingLogEntry,
  updateDrawingLogEntry,
} from "@/api/drawingLogs";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const input: DrawingLogInput = { drawingNo: "90000001", partNo: "", description: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
});

describe("useDrawingLogs mutation guards", () => {
  it("lets an admin create / update / record a change / delete", async () => {
    const create = renderHook(() => useCreateDrawingLogEntry("ccc"), { wrapper });
    await create.result.current.mutateAsync(input);
    expect(createDrawingLogEntry as Mock).toHaveBeenCalled();

    const update = renderHook(() => useUpdateDrawingLogEntry("ccc"), { wrapper });
    await update.result.current.mutateAsync({ id: 1, input });
    expect(updateDrawingLogEntry as Mock).toHaveBeenCalled();

    const append = renderHook(() => useAppendDrawingChange("ccc"), { wrapper });
    await append.result.current.mutateAsync({
      id: 1,
      change: { date: null, ecn: "ECN-1", rev: "A" },
    });
    expect(appendDrawingChange as Mock).toHaveBeenCalled();

    const remove = renderHook(() => useDeleteDrawingLogEntry("ccc"), { wrapper });
    await remove.result.current.mutateAsync(1);
    expect(deleteDrawingLogEntry as Mock).toHaveBeenCalled();
  });

  it("blocks a non-admin from every write, without reaching SharePoint", async () => {
    mocks.isAdmin = false;

    const create = renderHook(() => useCreateDrawingLogEntry("ccc"), { wrapper });
    await expect(create.result.current.mutateAsync(input)).rejects.toThrow(/Only admins/i);

    const update = renderHook(() => useUpdateDrawingLogEntry("ccc"), { wrapper });
    await expect(update.result.current.mutateAsync({ id: 1, input })).rejects.toThrow(
      /Only admins/i,
    );

    const append = renderHook(() => useAppendDrawingChange("ccc"), { wrapper });
    await expect(
      append.result.current.mutateAsync({ id: 1, change: { date: null, ecn: "E", rev: "A" } }),
    ).rejects.toThrow(/Only admins/i);

    const remove = renderHook(() => useDeleteDrawingLogEntry("ccc"), { wrapper });
    await expect(remove.result.current.mutateAsync(1)).rejects.toThrow(/Only admins/i);

    expect(createDrawingLogEntry as Mock).not.toHaveBeenCalled();
    expect(updateDrawingLogEntry as Mock).not.toHaveBeenCalled();
    expect(appendDrawingChange as Mock).not.toHaveBeenCalled();
    expect(deleteDrawingLogEntry as Mock).not.toHaveBeenCalled();
  });
});
