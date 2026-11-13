import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Crimp Height Checks hooks:
//  - every admin-only write asks INSIDE its mutationFn (deleting a check,
//    every spec write), awaiting the Admins list;
//  - recording and correcting a check is open to anyone — pinned so a tidy-up
//    can't quietly gate it;
//  - a spec any check was measured against can't be deleted, read FRESH;
//  - the out-of-spec email goes on a new out-of-spec check, and NOT on
//    re-saving one that was already out.
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
vi.mock("@/api/harnessAlertRecipients", () => ({
  listHarnessAlertRecipients: vi.fn(async () => mocks.recipients),
}));
vi.mock("@/api/email", () => ({
  sendCrimpOutOfSpecAlert: vi.fn(async () => ({ sent: ["supervisor@example.com"], failed: [] })),
  notifyChangeEmails: vi.fn(),
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/crimpChecks", () => ({
  CURRENT_CRIMP_YEAR: () => ({ kind: "year", year: 2026 }),
  listCrimpChecks: vi.fn(async () => []),
  getCrimpCheck: vi.fn(),
  listCrimpSpecUsage: vi.fn(async () => mocks.usage),
  createCrimpCheck: vi.fn(async () => mocks.saved),
  updateCrimpCheck: vi.fn(async () => mocks.saved),
  deleteCrimpCheck: vi.fn(async () => undefined),
}));
vi.mock("@/api/crimpSpecs", () => ({
  listCrimpSpecs: vi.fn(async () => []),
  createCrimpSpec: vi.fn(async () => ({ id: 1, terminal: "X", active: true })),
  updateCrimpSpec: vi.fn(async () => ({ id: 1, terminal: "X", active: true })),
  setCrimpSpecActive: vi.fn(async () => ({ id: 1, terminal: "X", active: false })),
  deleteCrimpSpec: vi.fn(async () => undefined),
}));

import {
  useCreateCrimpCheck,
  useCreateCrimpSpec,
  useDeleteCrimpCheck,
  useDeleteCrimpSpec,
  useUpdateCrimpCheck,
} from "./useCrimpChecks";
import { createCrimpCheck, deleteCrimpCheck } from "@/api/crimpChecks";
import { createCrimpSpec, deleteCrimpSpec } from "@/api/crimpSpecs";
import { sendCrimpOutOfSpecAlert } from "@/api/email";
import { MOCK_CRIMP_CHECKS } from "@/data/crimpMockData";
import { pushToast } from "@/components/Toast";
import type { CrimpCheckInput } from "@/types/crimp";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const outCheck = MOCK_CRIMP_CHECKS.find((c) => c.outOfSpec)!;
const inCheck = MOCK_CRIMP_CHECKS.find((c) => !c.outOfSpec)!;
const input = { checkPoint: "Start" } as unknown as CrimpCheckInput;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emails = ["someone@altronic-llc.com"];
  mocks.admins = [];
  mocks.usage = new Map();
  mocks.saved = inCheck;
  mocks.recipients = [
    { id: 1, name: "Supervisor", email: "supervisor@example.com", alert: "Crimp out of spec" },
    { id: 2, name: "Parts", email: "parts@example.com", alert: "Part number request" },
  ];
});

function makeAdmin() {
  mocks.admins = [{ email: "someone@altronic-llc.com", displayName: "Someone", id: 1 }];
}

describe("who can do what", () => {
  it("lets anyone record a check", async () => {
    const { result } = renderHook(() => useCreateCrimpCheck(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    expect(createCrimpCheck).toHaveBeenCalled();
  });

  it("refuses to delete a check for a non-admin, and allows an admin", async () => {
    const { result } = renderHook(() => useDeleteCrimpCheck(), { wrapper });
    await act(() => expect(result.current.mutateAsync(3)).rejects.toThrow(/Only ARC admins/));
    expect(deleteCrimpCheck).not.toHaveBeenCalled();

    makeAdmin();
    await act(() => result.current.mutateAsync(3));
    expect(deleteCrimpCheck).toHaveBeenCalledWith(3);
  });

  it("refuses a spec write for a non-admin", async () => {
    const { result } = renderHook(() => useCreateCrimpSpec(), { wrapper });
    await act(() => expect(result.current.mutateAsync({} as never)).rejects.toThrow(/Only ARC admins/));
    expect(createCrimpSpec).not.toHaveBeenCalled();
  });
});

describe("deleting a spec", () => {
  it("is refused while a check was measured against it", async () => {
    makeAdmin();
    mocks.usage = new Map([[4, 2]]);
    const { result } = renderHook(() => useDeleteCrimpSpec(), { wrapper });
    await act(() => expect(result.current.mutateAsync(4)).rejects.toThrow(/2 checks were measured against this spec/));
    expect(deleteCrimpSpec).not.toHaveBeenCalled();
  });

  it("goes ahead for a spec nobody has used", async () => {
    makeAdmin();
    mocks.usage = new Map([[4, 2]]);
    const { result } = renderHook(() => useDeleteCrimpSpec(), { wrapper });
    await act(() => result.current.mutateAsync(7));
    expect(deleteCrimpSpec).toHaveBeenCalledWith(7);
  });
});

describe("the out-of-spec email", () => {
  it("goes when a new check is out of spec", async () => {
    mocks.saved = outCheck;
    const { result } = renderHook(() => useCreateCrimpCheck(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    await waitFor(() => expect(sendCrimpOutOfSpecAlert).toHaveBeenCalledTimes(1));
    // Only the "Crimp out of spec" people, read from the list — not the part request ones.
    expect(vi.mocked(sendCrimpOutOfSpecAlert).mock.calls[0][0]).toMatchObject({
      check: outCheck,
      recipients: [{ displayName: "Supervisor", email: "supervisor@example.com" }],
    });
  });

  it("tells the operator to tell their supervisor when nobody is on the list", async () => {
    mocks.saved = outCheck;
    mocks.recipients = [];
    const { result } = renderHook(() => useCreateCrimpCheck(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    await waitFor(() =>
      expect(vi.mocked(pushToast)).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Tell your supervisor/) })),
    );
    expect(sendCrimpOutOfSpecAlert).not.toHaveBeenCalled();
  });

  it("doesn't go for an in-spec check", async () => {
    mocks.saved = inCheck;
    const { result } = renderHook(() => useCreateCrimpCheck(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    expect(sendCrimpOutOfSpecAlert).not.toHaveBeenCalled();
  });

  it("doesn't go again when a check that was already out is re-saved", async () => {
    mocks.saved = { ...outCheck, notes: "typo fixed" };
    const { result } = renderHook(() => useUpdateCrimpCheck(), { wrapper });
    await act(() => result.current.mutateAsync({ before: outCheck, input }));
    expect(sendCrimpOutOfSpecAlert).not.toHaveBeenCalled();
  });

  it("goes when an edit makes an in-spec check out of spec", async () => {
    mocks.saved = { ...inCheck, outOfSpec: true };
    const { result } = renderHook(() => useUpdateCrimpCheck(), { wrapper });
    await act(() => result.current.mutateAsync({ before: inCheck, input }));
    await waitFor(() => expect(sendCrimpOutOfSpecAlert).toHaveBeenCalledTimes(1));
  });
});
