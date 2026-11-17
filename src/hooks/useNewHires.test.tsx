import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// =============================================================================
// New Hire writes, driven with no screen: the HR gate is asked INSIDE every
// mutationFn (a future screen that forgets to hide a button is still refused),
// and the right people are emailed. Mock mode; the email sender is the one
// thing replaced, so what reaches it can be read.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
const notifyChangeEmails = vi.hoisted(() => vi.fn(async () => ({ sent: [], failed: [] })));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.email }),
  useCurrentUserEmails: () => [who.email],
}));
vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  notifyChangeEmails,
}));

import { __resetNewHireMockStore, getNewHire } from "@/api/newHires";
import { __resetHrRoleMockStore } from "@/api/hrRoles";
import { emptyNewHireInput } from "@/lib/newHire";
import { useCreateNewHire, useSetNewHireCancelled, useSetNewHireStep } from "./useNewHires";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const input = {
  ...emptyNewHireInput(),
  startDate: "2030-01-15",
  legalFirstName: "Pat",
  lastName: "Tester",
  email: "Pat.Tester@altronic-llc.com",
  jobTitle: "Assembler",
  employmentType: "Permanent" as const,
  department: "Operations",
  manager: { displayName: "Jordan Manager", email: "jordan.manager@example.com" },
  needsComputer: true,
};

function recipients(): string[] {
  const calls = notifyChangeEmails.mock.calls as unknown as Array<[{ emails: { email: string }[] }]>;
  return calls.flatMap(([arg]) => arg.emails.map((e) => e.email)).sort();
}

beforeEach(() => {
  __resetNewHireMockStore();
  __resetHrRoleMockStore();
  notifyChangeEmails.mockClear();
  who.email = "demo.user@altronic-llc.com";
});

describe("the gate", () => {
  it("refuses somebody without an HR role", async () => {
    who.email = "reader@example.com";
    const { result } = renderHook(() => useCreateNewHire(), { wrapper });
    await act(() => expect(result.current.mutateAsync(input)).rejects.toThrow(/New Hire role/));
  });

  it("refuses the hire's own manager, who holds no HR role", async () => {
    who.email = "jordan.manager@example.com";
    const { result } = renderHook(() => useSetNewHireStep(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: 1, step: "addedToSap", done: true })).rejects.toThrow(/New Hire role/));
    expect((await getNewHire(1))?.steps.addedToSap).toBeNull();
  });

  it("refuses a submission that's missing a required field", async () => {
    const { result } = renderHook(() => useCreateNewHire(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ ...input, manager: null })).rejects.toThrow(/Fill in Manager/));
  });
});

describe("the emails", () => {
  it("asks the SAP and IT people and tells the manager when a hire is submitted", async () => {
    // Somebody holding only "new hire sap" can submit too.
    who.email = "sam.placeholder@example.com";
    const { result } = renderHook(() => useCreateNewHire(), { wrapper });
    const created = await act(() => result.current.mutateAsync(input));
    expect(created.status).toBe("Submitted");
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    // The demo user holds both tags; Sam (the actor) is dropped because others are left.
    expect(recipients()).toEqual(["demo.user@altronic-llc.com", "jordan.manager@example.com", "quinn.sample@example.com"]);
  });

  it("tells the submitter and the manager when the last step is ticked — and only then", async () => {
    const { result } = renderHook(() => useSetNewHireStep(), { wrapper });
    // Hire 4 needs no computer and has SAP done: two steps left.
    await act(() => result.current.mutateAsync({ id: 4, step: "itTicketRaised", done: true }));
    expect(notifyChangeEmails).not.toHaveBeenCalled();
    const after = await act(() => result.current.mutateAsync({ id: 4, step: "itAccountCreated", done: true }));
    expect(after.after.status).toBe("Complete");
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalledTimes(1));
    expect(recipients()).toEqual(["avery.example@example.com", "casey.lead@example.com"]);
  });

  it("tells SAP, IT and the manager to stop when a hire is cancelled", async () => {
    const { result } = renderHook(() => useSetNewHireCancelled(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 1, reason: "Offer declined" }));
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalledTimes(1));
    expect(recipients()).toEqual(["jordan.manager@example.com", "quinn.sample@example.com", "sam.placeholder@example.com"]);
  });
});
