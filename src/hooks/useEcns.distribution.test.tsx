import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEcns, useSendEcnDistribution, useUpdateEcnFields } from "./useEcns";
import { __resetEcnsForTests, getEcn } from "@/api/ecns";
import { __resetEcnDistributionGroupsMockStore } from "@/api/ecnDistributionGroups";
import { ecnDistributionPatch } from "@/lib/ecnMapper";
import type { Ecn } from "@/types/task";

// =============================================================================
// BusinessIT#57 — the first time an ECN's Sign-off status is filled in, it is
// emailed to everyone in its ticked roles and who it went to is recorded.
// Mock mode, end to end through the hook: the groups come from the mock list,
// the send is the only thing stubbed.
//
// Every "stays quiet" case starts from a row where the guard has something to
// catch — a fixture already signed off, already sent, or with nothing ticked.
// =============================================================================

const { notifyChangeEmails, pushToast } = vi.hoisted(() => ({
  notifyChangeEmails: vi.fn(async (input: { emails: Array<{ email: string }> }) => ({
    sent: input.emails.map((e) => e.email),
    failed: [],
  })),
  pushToast: vi.fn(),
}));

vi.mock("@/api/email", () => ({
  notifyChangeEmails,
  notifyMentions: vi.fn(async () => ({ sent: [], failed: [] })),
}));
vi.mock("@/components/Toast", () => ({ pushToast }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Bailey Buyer", email: "bailey.buyer@example.com", lookupId: 5 }),
}));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setup() {
  return renderHook(() => ({ list: useEcns(), update: useUpdateEcnFields(), send: useSendEcnDistribution() }), {
    wrapper: wrapper(),
  });
}

function signOff(value: string) {
  return {
    fields: { field_12: value },
    patch: (e: Ecn) => ({ ...e, values: { ...e.values, signOffStatus: value } }),
  };
}

function recipientsOfLastSend(): string[] {
  const input = notifyChangeEmails.mock.calls.at(-1)?.[0] as { emails: Array<{ email: string }> };
  return input.emails.map((e) => e.email).sort();
}

beforeEach(() => {
  __resetEcnsForTests();
  __resetEcnDistributionGroupsMockStore();
  notifyChangeEmails.mockClear();
  pushToast.mockClear();
});

describe("sending on sign-off", () => {
  it("emails the ticked roles' people (not the signer) and records who it went to", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    // ECN 1 starts with the paper form's seven ticks and no sign-off.
    await act(() => result.current.update.mutateAsync({ id: 1, ...signOff("Approved") }));

    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalledTimes(1));
    const emailed = recipientsOfLastSend();
    expect(emailed).toContain("quinn.quality@example.com");
    expect(emailed).toContain("sam.sales@example.com");
    // The signer is in Purchasing Manager — strictly left off.
    expect(emailed).not.toContain("bailey.buyer@example.com");
    // CAD Department isn't ticked on ECN 1.
    expect(emailed).not.toContain("casey.drafter@example.com");
    // Quinn is in two ticked roles and gets ONE email.
    expect(emailed.filter((e) => e === "quinn.quality@example.com")).toHaveLength(1);

    await waitFor(async () => expect((await getEcn(1))?.distributedAt).toBeInstanceOf(Date));
    const recorded = (await getEcn(1))!;
    expect(recorded.distributedTo.map((p) => p.email).sort()).toEqual(emailed);
  });

  it("does NOT send when the sign-off was already filled in — a later edit", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    // ECN 3 is already signed off ("Complete") and sent.
    await act(() => result.current.update.mutateAsync({ id: 3, ...signOff("Complete - KB") }));
    await new Promise((r) => setTimeout(r, 20));
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("does NOT send when nothing is ticked, and says so", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    // ECN 5 predates distribution — nothing ticked.
    await act(() => result.current.update.mutateAsync({ id: 5, ...signOff("Approved") }));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("No distribution roles") })),
    );
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("does NOT send an unrelated edit", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    await act(() =>
      result.current.update.mutateAsync({
        id: 1,
        fields: ecnDistributionPatch(["Sales"]),
        patch: (e) => ({ ...e, distribution: ["Sales"] }),
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });
});

describe("Send now", () => {
  it("sends an ECN that is signed off but was never sent", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    // Fill in the sign-off with no ticks (nothing sends), then tick and press Send now.
    await act(() => result.current.update.mutateAsync({ id: 5, ...signOff("Approved") }));
    await act(() =>
      result.current.update.mutateAsync({
        id: 5,
        fields: ecnDistributionPatch(["Sales"]),
        patch: (e) => ({ ...e, distribution: ["Sales"] }),
      }),
    );
    expect(notifyChangeEmails).not.toHaveBeenCalled();

    await act(() => result.current.send.mutateAsync(5));
    expect(recipientsOfLastSend()).toEqual(["robin.accounts@example.com", "sam.sales@example.com"]);
    expect((await getEcn(5))?.distributedAt).toBeInstanceOf(Date);
  });

  it("refuses an ECN that was already sent, so it isn't sent twice", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    await act(() => expect(result.current.send.mutateAsync(3)).rejects.toThrow(/already sent/));
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });
});
