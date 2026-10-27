import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Harness Alert Recipients hooks:
//  - adding and removing a recipient is ARC-admin only, asked in the mutationFn;
//  - a part number request goes to the "Part number request" people ONLY,
//    refuses a number that's already live, and throws when it reaches nobody.
// =============================================================================

const mocks = vi.hoisted(() => ({
  admins: [] as Array<{ email: string; displayName: string; id: number }>,
  recipients: [] as Array<{ id: number; name: string; email: string; alert: string }>,
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUserEmails: () => ["someone@altronic-llc.com"],
  useCurrentUser: () => ({ displayName: "Op", email: "someone@altronic-llc.com", lookupId: 1 }),
}));
vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => false,
  useAdminAccess: () => ({ isAdmin: false, isResolving: false }),
}));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => mocks.admins) }));
vi.mock("@/api/harnessAlertRecipients", () => ({
  listHarnessAlertRecipients: vi.fn(async () => mocks.recipients),
  addHarnessAlertRecipient: vi.fn(async (input) => ({ id: 9, ...input })),
  removeHarnessAlertRecipient: vi.fn(async () => undefined),
}));
vi.mock("@/api/harnessPartNumbers", () => ({
  listHarnessPartNumbers: vi.fn(async () => [
    { lookupId: 1, title: "593027-15", description: "", active: true, note: "" },
    { lookupId: 2, title: "593030-18", description: "", active: false, note: "" },
  ]),
}));
vi.mock("@/api/email", () => ({
  notifyChangeEmails: vi.fn(async ({ emails }: { emails: Array<{ email: string }> }) => ({
    sent: emails.map((e) => e.email),
    failed: [],
  })),
}));

import {
  useAddHarnessAlertRecipient,
  useRemoveHarnessAlertRecipient,
  useRequestHarnessPartNumber,
} from "./useHarnessAlertRecipients";
import { addHarnessAlertRecipient, removeHarnessAlertRecipient } from "@/api/harnessAlertRecipients";
import { notifyChangeEmails } from "@/api/email";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admins = [];
  mocks.recipients = [
    { id: 1, name: "Harness Lead", email: "lead@example.com", alert: "Part number request" },
    { id: 2, name: "Supervisor", email: "supervisor@example.com", alert: "Crimp out of spec" },
  ];
});

describe("changing who is notified", () => {
  it("is refused for somebody who isn't an ARC admin", async () => {
    const add = renderHook(() => useAddHarnessAlertRecipient(), { wrapper }).result;
    const remove = renderHook(() => useRemoveHarnessAlertRecipient(), { wrapper }).result;
    await act(() =>
      expect(add.current.mutateAsync({ name: "X", email: "x@example.com", alert: "Crimp out of spec" })).rejects.toThrow(
        /Only ARC admins/,
      ),
    );
    await act(() => expect(remove.current.mutateAsync(1)).rejects.toThrow(/Only ARC admins/));
    expect(addHarnessAlertRecipient).not.toHaveBeenCalled();
    expect(removeHarnessAlertRecipient).not.toHaveBeenCalled();
  });

  it("goes ahead for an ARC admin", async () => {
    mocks.admins = [{ email: "someone@altronic-llc.com", displayName: "Someone", id: 1 }];
    const { result } = renderHook(() => useRemoveHarnessAlertRecipient(), { wrapper });
    await act(() => result.current.mutateAsync(1));
    expect(removeHarnessAlertRecipient).toHaveBeenCalledWith(1);
  });
});

describe("requesting a part number", () => {
  it("emails the part-request people only, and says who", async () => {
    const { result } = renderHook(() => useRequestHarnessPartNumber(), { wrapper });
    const sentTo = await act(() => result.current.mutateAsync({ partNumber: "999001-1", description: "", note: "" }));
    expect(sentTo).toEqual(["Harness Lead"]);
    const call = vi.mocked(notifyChangeEmails).mock.calls[0][0];
    expect(call.emails.map((e) => e.email)).toEqual(["lead@example.com"]);
    expect(call.target.thread).toBeNull();
  });

  it("refuses a number that's already live", async () => {
    const { result } = renderHook(() => useRequestHarnessPartNumber(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ partNumber: "593027-15", description: "", note: "" })).rejects.toThrow(
        /already on the list/,
      ),
    );
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("throws when nobody is set up to receive it", async () => {
    mocks.recipients = mocks.recipients.filter((r) => r.alert !== "Part number request");
    const { result } = renderHook(() => useRequestHarnessPartNumber(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ partNumber: "593030-18", description: "", note: "" })).rejects.toThrow(
        /Nobody is set up/,
      ),
    );
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });
});
