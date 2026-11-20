import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Conformal Coating Checks hooks — the crimp log's rules (Tim, 2026-11-04):
//  - every admin-only write asks INSIDE its mutationFn (deleting a check,
//    every spec write), awaiting the Admins list;
//  - recording and correcting a check is open to anyone;
//  - a spec any check was judged against can't be deleted, read FRESH;
//  - the out-of-spec email goes on a new out-of-spec check, to the Operations
//    "Coating out of spec" people, and NOT on re-saving one already out.
// =============================================================================

const mocks = vi.hoisted(() => ({
  emails: ["someone@altronic-llc.com"],
  admins: [] as Array<{ email: string; displayName: string; id: number }>,
  usage: new Map<number, number>(),
  saved: null as unknown,
  recipients: [] as Array<{ id: number; name: string; email: string; alert: string }>,
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUserEmails: () => mocks.emails,
  useCurrentUser: () => ({ displayName: "Op", email: mocks.emails[0], lookupId: 1 }),
}));
vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => false,
  useAdminAccess: () => ({ isAdmin: false, isResolving: false }),
}));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => mocks.admins) }));
vi.mock("@/api/operationsAlertRecipients", () => ({
  listOperationsAlertRecipients: vi.fn(async () => mocks.recipients),
}));
vi.mock("@/api/email", () => ({
  sendCoatingOutOfSpecAlert: vi.fn(async () => ({ sent: ["supervisor@example.com"], failed: [] })),
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/coatingChecks", () => ({
  CURRENT_COATING_YEAR: () => ({ kind: "year", year: 2026 }),
  listCoatingChecks: vi.fn(async () => []),
  getCoatingCheck: vi.fn(),
  listCoatingSpecUsage: vi.fn(async () => mocks.usage),
  createCoatingCheck: vi.fn(async () => mocks.saved),
  updateCoatingCheck: vi.fn(async () => mocks.saved),
  deleteCoatingCheck: vi.fn(async () => undefined),
}));
vi.mock("@/api/coatingSpecs", () => ({
  listCoatingSpecs: vi.fn(async () => []),
  createCoatingSpec: vi.fn(async () => ({ id: 1, name: "X", active: true })),
  updateCoatingSpec: vi.fn(async () => ({ id: 1, name: "X", active: true })),
  setCoatingSpecActive: vi.fn(async () => ({ id: 1, name: "X", active: false })),
  deleteCoatingSpec: vi.fn(async () => undefined),
}));

import {
  useCreateCoatingCheck,
  useCreateCoatingSpec,
  useDeleteCoatingCheck,
  useDeleteCoatingSpec,
  useSetCoatingSpecActive,
  useUpdateCoatingCheck,
  useUpdateCoatingSpec,
} from "./useCoatingChecks";
import { createCoatingCheck, deleteCoatingCheck, updateCoatingCheck } from "@/api/coatingChecks";
import { createCoatingSpec, deleteCoatingSpec, setCoatingSpecActive, updateCoatingSpec } from "@/api/coatingSpecs";
import { sendCoatingOutOfSpecAlert } from "@/api/email";
import { MOCK_COATING_CHECKS } from "@/data/coatingMockData";
import { pushToast } from "@/components/Toast";
import type { CoatingCheckInput } from "@/types/coating";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const outCheck = MOCK_COATING_CHECKS.find((c) => c.outOfSpec)!;
const inCheck = MOCK_COATING_CHECKS.find((c) => !c.outOfSpec)!;
const input = { machine: "X" } as unknown as CoatingCheckInput;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emails = ["someone@altronic-llc.com"];
  mocks.admins = [];
  mocks.usage = new Map();
  mocks.saved = inCheck;
  mocks.recipients = [{ id: 1, name: "Supervisor", email: "supervisor@example.com", alert: "Coating out of spec" }];
});

function makeAdmin() {
  mocks.admins = [{ email: "someone@altronic-llc.com", displayName: "Someone", id: 1 }];
}

describe("who can do what", () => {
  it("lets anyone record and correct a check", async () => {
    const create = renderHook(() => useCreateCoatingCheck(), { wrapper });
    await act(() => create.result.current.mutateAsync(input));
    expect(createCoatingCheck).toHaveBeenCalled();

    const update = renderHook(() => useUpdateCoatingCheck(), { wrapper });
    await act(() => update.result.current.mutateAsync({ before: inCheck, input }));
    expect(updateCoatingCheck).toHaveBeenCalledWith(inCheck.id, input);
  });

  it("refuses to delete a check for a non-admin, and allows an admin", async () => {
    const { result } = renderHook(() => useDeleteCoatingCheck(), { wrapper });
    await act(() => expect(result.current.mutateAsync(3)).rejects.toThrow(/Only ARC admins/));
    expect(deleteCoatingCheck).not.toHaveBeenCalled();

    // A fresh client: the first one has the (empty) Admins list cached.
    makeAdmin();
    const admin = renderHook(() => useDeleteCoatingCheck(), { wrapper });
    await act(() => admin.result.current.mutateAsync(3));
    expect(deleteCoatingCheck).toHaveBeenCalledWith(3);
  });

  it("refuses every spec write for a non-admin", async () => {
    const create = renderHook(() => useCreateCoatingSpec(), { wrapper });
    await act(() => expect(create.result.current.mutateAsync({} as never)).rejects.toThrow(/Only ARC admins/));
    const update = renderHook(() => useUpdateCoatingSpec(), { wrapper });
    await act(() => expect(update.result.current.mutateAsync({ id: 1, input: {} as never })).rejects.toThrow(/Only ARC admins/));
    const retire = renderHook(() => useSetCoatingSpecActive(), { wrapper });
    await act(() => expect(retire.result.current.mutateAsync({ id: 1, active: false })).rejects.toThrow(/Only ARC admins/));
    expect(createCoatingSpec).not.toHaveBeenCalled();
    expect(updateCoatingSpec).not.toHaveBeenCalled();
    expect(setCoatingSpecActive).not.toHaveBeenCalled();
  });
});

describe("deleting a spec", () => {
  it("is refused while a check was judged against it", async () => {
    makeAdmin();
    mocks.usage = new Map([[4, 2]]);
    const { result } = renderHook(() => useDeleteCoatingSpec(), { wrapper });
    await act(() => expect(result.current.mutateAsync(4)).rejects.toThrow(/2 checks were judged against this spec/));
    expect(deleteCoatingSpec).not.toHaveBeenCalled();
  });

  it("goes ahead for a spec nobody has used", async () => {
    makeAdmin();
    mocks.usage = new Map([[4, 2]]);
    const { result } = renderHook(() => useDeleteCoatingSpec(), { wrapper });
    await act(() => result.current.mutateAsync(7));
    expect(deleteCoatingSpec).toHaveBeenCalledWith(7);
  });
});

describe("the out-of-spec email", () => {
  it("goes to the Coating out of spec people when a new check is out", async () => {
    mocks.saved = outCheck;
    const { result } = renderHook(() => useCreateCoatingCheck(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    await waitFor(() => expect(sendCoatingOutOfSpecAlert).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendCoatingOutOfSpecAlert).mock.calls[0][0]).toMatchObject({
      check: outCheck,
      recipients: [{ displayName: "Supervisor", email: "supervisor@example.com" }],
    });
  });

  it("tells the operator to tell their supervisor when nobody is on the list", async () => {
    mocks.saved = outCheck;
    mocks.recipients = [];
    const { result } = renderHook(() => useCreateCoatingCheck(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    await waitFor(() =>
      expect(vi.mocked(pushToast)).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Tell your supervisor/) })),
    );
    expect(sendCoatingOutOfSpecAlert).not.toHaveBeenCalled();
  });

  it("doesn't go for an in-spec check", async () => {
    const { result } = renderHook(() => useCreateCoatingCheck(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    expect(sendCoatingOutOfSpecAlert).not.toHaveBeenCalled();
  });

  it("doesn't go again when a check that was already out is re-saved", async () => {
    mocks.saved = { ...outCheck, notes: "typo fixed" };
    const { result } = renderHook(() => useUpdateCoatingCheck(), { wrapper });
    await act(() => result.current.mutateAsync({ before: outCheck, input }));
    expect(sendCoatingOutOfSpecAlert).not.toHaveBeenCalled();
  });

  it("goes when an edit makes an in-spec check out of spec", async () => {
    mocks.saved = { ...inCheck, outOfSpec: true };
    const { result } = renderHook(() => useUpdateCoatingCheck(), { wrapper });
    await act(() => result.current.mutateAsync({ before: inCheck, input }));
    await waitFor(() => expect(sendCoatingOutOfSpecAlert).toHaveBeenCalledTimes(1));
  });
});
