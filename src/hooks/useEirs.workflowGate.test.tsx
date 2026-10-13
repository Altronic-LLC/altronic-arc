import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// BusinessIT#45: only the EIR workflow editors (Glenn, Brandon, Sheila, Ray)
// may change an EIR's Status or assigned engineer — asked INSIDE the
// mutationFn, so a future screen can't write either without the check.
//
// Real mode (`USE_MOCK: false`): mock mode always allows, so the gate is
// invisible from a mock-mode test.
// =============================================================================

const updateEirFields = vi.hoisted(() => vi.fn());
const setEirAssignedEngineers = vi.hoisted(() => vi.fn());
const resolveMyIdentity = vi.hoisted(() => vi.fn());

vi.mock("@/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/config")>()),
  USE_MOCK: false,
}));

vi.mock("@/api/eirs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/eirs")>()),
  updateEirFields,
  setEirAssignedEngineers,
  listEirs: vi.fn(async () => []),
}));

vi.mock("@/api/currentUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/currentUser")>()),
  resolveMyIdentity,
}));

vi.mock("@/api/email", () => ({
  fireFieldChangeAlert: vi.fn(),
  fireAssigneeChangeAlert: vi.fn(),
  fireChecklistToggleAlert: vi.fn(),
  fireEirTriageAlert: vi.fn(),
  fireEirClosedAlert: vi.fn(),
  fireEirResolvedAlert: vi.fn(),
  fireEirResponseAcceptedAlert: vi.fn(),
  fireEirResponseNotAcceptedAlert: vi.fn(),
  firePromotionAlert: vi.fn(),
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: "someone@altronic-llc.com", lookupId: 5 }),
}));

import { useSetEirAssignedEngineers, useUpdateEirFields } from "./useEirs";
import { EirWorkflowNotPermittedError } from "./useEirWorkflowAccess";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function signedInAs(email: string) {
  resolveMyIdentity.mockResolvedValue({ primary: email, all: [email] });
}

beforeEach(() => {
  updateEirFields.mockReset();
  updateEirFields.mockResolvedValue({});
  setEirAssignedEngineers.mockReset();
  setEirAssignedEngineers.mockResolvedValue({});
  resolveMyIdentity.mockReset();
});

describe("EIR Status writes", () => {
  it("refuses somebody who isn't a workflow editor, before any request", async () => {
    signedInAs("sarah.shaffer@altronic-llc.com");
    const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrapper() });
    await act(() =>
      expect(
        result.current.mutateAsync({ id: 1, fields: { Status: "Closed" } }),
      ).rejects.toBeInstanceOf(EirWorkflowNotPermittedError),
    );
    expect(updateEirFields).not.toHaveBeenCalled();
  });

  it("lets a workflow editor through", async () => {
    signedInAs("brandon.mirto@altronic-llc.com");
    const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrapper() });
    await act(() => result.current.mutateAsync({ id: 1, fields: { Status: "Closed" } }));
    expect(updateEirFields).toHaveBeenCalledWith(1, { Status: "Closed" });
  });

  // Completing the task an EIR was promoted to closes the EIR — the workflow
  // running, not a hand edit — so whoever completes the task isn't refused.
  it("lets the linked-task close through for anybody", async () => {
    signedInAs("sarah.shaffer@altronic-llc.com");
    const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrapper() });
    await act(() =>
      result.current.mutateAsync({
        id: 1,
        fields: { Status: "Closed", Resolution: "Resolved" },
        viaLinkedTask: true,
      }),
    );
    expect(updateEirFields).toHaveBeenCalled();
  });

  it("doesn't gate a write that leaves Status alone", async () => {
    signedInAs("sarah.shaffer@altronic-llc.com");
    const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrapper() });
    await act(() => result.current.mutateAsync({ id: 1, fields: { BuyerCode: "AB" } }));
    expect(updateEirFields).toHaveBeenCalled();
    expect(resolveMyIdentity).not.toHaveBeenCalled();
  });

  // "Couldn't check" must never read as "allowed".
  it("refuses when the account's addresses couldn't be read", async () => {
    resolveMyIdentity.mockResolvedValue({ primary: "", all: [] });
    const { result } = renderHook(() => useUpdateEirFields(), { wrapper: wrapper() });
    await act(() =>
      expect(
        result.current.mutateAsync({ id: 1, fields: { Status: "Closed" } }),
      ).rejects.toBeInstanceOf(EirWorkflowNotPermittedError),
    );
    expect(updateEirFields).not.toHaveBeenCalled();
  });
});

describe("EIR assigned-engineer writes", () => {
  const ENGINEER = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" };

  it("refuses somebody who isn't a workflow editor", async () => {
    signedInAs("sarah.shaffer@altronic-llc.com");
    const { result } = renderHook(() => useSetEirAssignedEngineers(), { wrapper: wrapper() });
    await act(() =>
      expect(result.current.mutateAsync({ id: 1, people: [ENGINEER] })).rejects.toBeInstanceOf(
        EirWorkflowNotPermittedError,
      ),
    );
    expect(setEirAssignedEngineers).not.toHaveBeenCalled();
  });

  it("lets a workflow editor through", async () => {
    signedInAs("glenn.terry@altronic-llc.com");
    const { result } = renderHook(() => useSetEirAssignedEngineers(), { wrapper: wrapper() });
    await act(() => result.current.mutateAsync({ id: 1, people: [ENGINEER] }));
    expect(setEirAssignedEngineers).toHaveBeenCalledWith(1, [ENGINEER]);
  });
});
