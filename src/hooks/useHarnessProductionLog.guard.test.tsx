import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Every admin-only Harness write asks INSIDE its mutationFn, and awaits the
// Admins list rather than trusting the render-time flag (which reads false
// while that list loads). Adding and editing a LOG ENTRY is open to anyone —
// also pinned, so a future "tidy-up" can't quietly gate it.
// =============================================================================

const mocks = vi.hoisted(() => ({
  emails: ["someone@altronic-llc.com"],
  admins: [] as Array<{ email: string; displayName: string; id: number }>,
  renderTimeAdmin: false,
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUserEmails: () => mocks.emails,
  useCurrentUser: () => ({ displayName: "x", email: mocks.emails[0], lookupId: 1 }),
}));
vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => mocks.renderTimeAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.renderTimeAdmin, isResolving: false }),
}));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => mocks.admins) }));
vi.mock("@/api/harnessProductionLog", () => ({
  CURRENT_HARNESS_YEAR: () => ({ kind: "year", year: 2026 }),
  listHarnessLog: vi.fn(),
  listHarnessPartUsage: vi.fn(),
  createHarnessLogEntry: vi.fn(async () => ({ id: 1 })),
  updateHarnessLogEntry: vi.fn(async () => ({ id: 1 })),
  deleteHarnessLogEntry: vi.fn(async () => undefined),
}));
vi.mock("@/api/harnessPartNumbers", () => ({
  listHarnessPartNumbers: vi.fn(),
  createHarnessPartNumber: vi.fn(async () => ({ lookupId: 1, title: "X", active: true })),
  updateHarnessPartNumber: vi.fn(async () => ({ lookupId: 1, title: "X", active: true })),
  setHarnessPartNumberActive: vi.fn(async () => ({ lookupId: 1, title: "X", active: false })),
}));

import {
  useCreateHarnessLogEntry,
  useCreateHarnessPartNumber,
  useDeleteHarnessLogEntry,
  useSetHarnessPartNumberActive,
  useUpdateHarnessLogEntry,
  useUpdateHarnessPartNumber,
} from "./useHarnessProductionLog";
import { createHarnessLogEntry, deleteHarnessLogEntry, updateHarnessLogEntry } from "@/api/harnessProductionLog";
import {
  createHarnessPartNumber,
  setHarnessPartNumberActive,
  updateHarnessPartNumber,
} from "@/api/harnessPartNumbers";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const input = {
  productionDate: null,
  workOrder: "",
  partLookupId: 1,
  quantity: 1,
  reworkQuantity: 0,
  comments: "",
  builtBy: "",
  visualCheck: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emails = ["someone@altronic-llc.com"];
  mocks.admins = [];
  mocks.renderTimeAdmin = false;
});

describe("admin-only Harness writes", () => {
  it("refuses a non-admin, and never reaches the API", async () => {
    const del = renderHook(() => useDeleteHarnessLogEntry(), { wrapper });
    await act(() => expect(del.result.current.mutateAsync(5)).rejects.toThrow(/Only ARC admins/));
    expect(deleteHarnessLogEntry as Mock).not.toHaveBeenCalled();

    const add = renderHook(() => useCreateHarnessPartNumber(), { wrapper });
    await act(() => expect(add.result.current.mutateAsync({ title: "X" })).rejects.toThrow(/Only ARC admins/));
    const rename = renderHook(() => useUpdateHarnessPartNumber(), { wrapper });
    await act(() =>
      expect(rename.result.current.mutateAsync({ lookupId: 1, input: { title: "X" } })).rejects.toThrow(/Only ARC admins/),
    );
    const retire = renderHook(() => useSetHarnessPartNumberActive(), { wrapper });
    await act(() =>
      expect(retire.result.current.mutateAsync({ lookupId: 1, active: false })).rejects.toThrow(/Only ARC admins/),
    );
    expect(createHarnessPartNumber as Mock).not.toHaveBeenCalled();
    expect(updateHarnessPartNumber as Mock).not.toHaveBeenCalled();
    expect(setHarnessPartNumberActive as Mock).not.toHaveBeenCalled();
  });

  it("lets an admin on the Admins list through, even while the render-time flag still says no", async () => {
    mocks.admins = [{ id: 1, email: "someone@altronic-llc.com", displayName: "S" }];
    mocks.renderTimeAdmin = false;
    const del = renderHook(() => useDeleteHarnessLogEntry(), { wrapper });
    await act(() => del.result.current.mutateAsync(5));
    expect(deleteHarnessLogEntry as Mock).toHaveBeenCalledWith(5);

    const retire = renderHook(() => useSetHarnessPartNumberActive(), { wrapper });
    await act(() => retire.result.current.mutateAsync({ lookupId: 1, active: false }));
    expect(setHarnessPartNumberActive as Mock).toHaveBeenCalledWith(1, false);
  });
});

describe("open Harness writes", () => {
  it("lets anyone add and edit a log entry", async () => {
    const add = renderHook(() => useCreateHarnessLogEntry(), { wrapper });
    await act(() => add.result.current.mutateAsync(input));
    expect(createHarnessLogEntry as Mock).toHaveBeenCalled();

    const edit = renderHook(() => useUpdateHarnessLogEntry(), { wrapper });
    await act(() => edit.result.current.mutateAsync({ id: 1, input }));
    expect(updateHarnessLogEntry as Mock).toHaveBeenCalled();
  });
});
