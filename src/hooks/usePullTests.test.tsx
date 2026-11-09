import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Pull Tests hooks — the crimp rules, copied:
//  - every admin-only write asks INSIDE its mutationFn (deleting a test, every
//    spec write), awaiting the Admins list;
//  - recording a test is open to anyone;
//  - a spec any test was judged by can't be deleted, read FRESH;
//  - the failed-pull email goes to the "Pull test failed" people only, on a
//    new failed test, and NOT on re-saving one that had already failed.
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
  sendPullTestFailedAlert: vi.fn(async () => ({ sent: ["supervisor@example.com"], failed: [] })),
  notifyChangeEmails: vi.fn(),
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/pullTests", () => ({
  CURRENT_PULL_TEST_YEAR: () => ({ kind: "year", year: 2026 }),
  listPullTests: vi.fn(async () => []),
  getPullTest: vi.fn(),
  listPullTestSpecUsage: vi.fn(async () => mocks.usage),
  createPullTest: vi.fn(async () => mocks.saved),
  updatePullTest: vi.fn(async () => mocks.saved),
  deletePullTest: vi.fn(async () => undefined),
}));
vi.mock("@/api/pullTestSpecs", () => ({
  listPullTestSpecs: vi.fn(async () => []),
  createPullTestSpec: vi.fn(async () => ({ id: 1, terminal: "X", wireGauge: "18", reference: "", active: true })),
  updatePullTestSpec: vi.fn(),
  setPullTestSpecActive: vi.fn(),
  deletePullTestSpec: vi.fn(async () => undefined),
}));

import {
  useCreatePullTest,
  useCreatePullTestSpec,
  useDeletePullTest,
  useDeletePullTestSpec,
  useUpdatePullTest,
} from "./usePullTests";
import { createPullTest, deletePullTest } from "@/api/pullTests";
import { createPullTestSpec, deletePullTestSpec } from "@/api/pullTestSpecs";
import { sendPullTestFailedAlert } from "@/api/email";
import { MOCK_PULL_TESTS } from "@/data/pullTestMockData";
import { pushToast } from "@/components/Toast";
import type { PullTestInput } from "@/types/pullTest";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const failedTest = MOCK_PULL_TESTS.find((t) => t.failed)!;
const passedTest = MOCK_PULL_TESTS.find((t) => !t.failed && t.minimumForce !== null)!;
const input = { checkPoint: "Start" } as unknown as PullTestInput;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admins = [];
  mocks.usage = new Map();
  mocks.saved = passedTest;
  mocks.recipients = [
    { id: 1, name: "Supervisor", email: "supervisor@example.com", alert: "Pull test failed" },
    { id: 2, name: "Crimp lead", email: "crimp@example.com", alert: "Crimp out of spec" },
  ];
});

function makeAdmin() {
  mocks.admins = [{ email: "someone@altronic-llc.com", displayName: "Someone", id: 1 }];
}

describe("who can do what", () => {
  it("lets anyone record a test", async () => {
    const { result } = renderHook(() => useCreatePullTest(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    expect(createPullTest).toHaveBeenCalled();
  });

  it("refuses to delete a test for a non-admin, and allows an admin", async () => {
    const { result } = renderHook(() => useDeletePullTest(), { wrapper });
    await act(() => expect(result.current.mutateAsync(3)).rejects.toThrow(/Only ARC admins/));
    expect(deletePullTest).not.toHaveBeenCalled();

    makeAdmin();
    await act(() => result.current.mutateAsync(3));
    expect(deletePullTest).toHaveBeenCalledWith(3);
  });

  it("refuses a spec write for a non-admin", async () => {
    const { result } = renderHook(() => useCreatePullTestSpec(), { wrapper });
    await act(() => expect(result.current.mutateAsync({} as never)).rejects.toThrow(/Only ARC admins/));
    expect(createPullTestSpec).not.toHaveBeenCalled();
  });
});

describe("deleting a spec", () => {
  it("is refused while a test was judged by it", async () => {
    makeAdmin();
    mocks.usage = new Map([[3, 2]]);
    const { result } = renderHook(() => useDeletePullTestSpec(), { wrapper });
    await act(() => expect(result.current.mutateAsync(3)).rejects.toThrow(/2 tests were judged by this spec/));
    expect(deletePullTestSpec).not.toHaveBeenCalled();
  });

  it("goes ahead for a spec nobody has used", async () => {
    makeAdmin();
    mocks.usage = new Map([[3, 2]]);
    const { result } = renderHook(() => useDeletePullTestSpec(), { wrapper });
    await act(() => result.current.mutateAsync(7));
    expect(deletePullTestSpec).toHaveBeenCalledWith(7);
  });
});

describe("the failed-pull email", () => {
  it("goes to the 'Pull test failed' people when a new test fails", async () => {
    mocks.saved = failedTest;
    const { result } = renderHook(() => useCreatePullTest(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    await waitFor(() => expect(sendPullTestFailedAlert).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendPullTestFailedAlert).mock.calls[0][0]).toMatchObject({
      test: failedTest,
      recipients: [{ displayName: "Supervisor", email: "supervisor@example.com" }],
    });
  });

  it("tells the operator to tell their supervisor when nobody is on the list", async () => {
    mocks.saved = failedTest;
    mocks.recipients = [];
    const { result } = renderHook(() => useCreatePullTest(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    await waitFor(() =>
      expect(vi.mocked(pushToast)).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/Tell your supervisor/) }),
      ),
    );
    expect(sendPullTestFailedAlert).not.toHaveBeenCalled();
  });

  it("doesn't go for a test that passed", async () => {
    const { result } = renderHook(() => useCreatePullTest(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    expect(sendPullTestFailedAlert).not.toHaveBeenCalled();
  });

  it("doesn't go again when a failed test is re-saved", async () => {
    mocks.saved = { ...failedTest, notes: "work order fixed" };
    const { result } = renderHook(() => useUpdatePullTest(), { wrapper });
    await act(() => result.current.mutateAsync({ before: failedTest, input }));
    expect(sendPullTestFailedAlert).not.toHaveBeenCalled();
  });

  it("goes when an edit makes a passing test fail", async () => {
    mocks.saved = { ...passedTest, failed: true };
    const { result } = renderHook(() => useUpdatePullTest(), { wrapper });
    await act(() => result.current.mutateAsync({ before: passedTest, input }));
    await waitFor(() => expect(sendPullTestFailedAlert).toHaveBeenCalledTimes(1));
  });
});
