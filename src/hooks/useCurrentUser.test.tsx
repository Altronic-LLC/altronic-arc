import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// =============================================================================
// Which account the signed-in Person is built from.
//
// Every "who did this" field in ARC — Requestor, Assigned, Watchers, comment
// authorship — comes from this hook. Until 2026-10-16 it read `accounts[0]`:
// the first account MSAL had cached, regardless of which one was active. On a
// shared browser that is somebody else (the 2026-09-02 Gray Market Request
// filed under a colleague's name). The rule is auth/activeAccount.ts's.
// =============================================================================

const msal = vi.hoisted(() => ({
  accounts: [] as Array<{ homeAccountId: string; username: string; name?: string }>,
  activeAccount: null as { homeAccountId: string; username: string; name?: string } | null,
}));

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({
    accounts: msal.accounts,
    instance: { getActiveAccount: () => msal.activeAccount },
  }),
}));

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return { ...actual, USE_MOCK: false };
});

const api = vi.hoisted(() => ({
  resolveMyIdentity: vi.fn(),
  resolveCurrentUserLookupId: vi.fn(),
}));
vi.mock("@/api/currentUser", () => api);

import { useCurrentUser, useCurrentUserEmails } from "./useCurrentUser";

const FIRST = { homeAccountId: "acct-1", username: "first.person@altronic-llc.com", name: "First Person" };
const SECOND = { homeAccountId: "acct-2", username: "second.person@altronic-llc.com", name: "Second Person" };

beforeEach(() => {
  vi.clearAllMocks();
  msal.accounts = [];
  msal.activeAccount = null;
  // /me never answers in these tests, so the hook stays on the token's own
  // address and never asks for a lookupId.
  api.resolveMyIdentity.mockReturnValue(new Promise(() => {}));
  api.resolveCurrentUserLookupId.mockResolvedValue(0);
});

describe("useCurrentUser", () => {
  it("is the ACTIVE account, not the first cached one", () => {
    msal.accounts = [FIRST, SECOND];
    msal.activeAccount = SECOND;

    const { result } = renderHook(() => useCurrentUser());

    expect(result.current.email).toBe("second.person@altronic-llc.com");
    expect(result.current.displayName).toBe("Second Person");
  });

  it("is nobody when two accounts are cached and none has been chosen", () => {
    msal.accounts = [FIRST, SECOND];
    msal.activeAccount = null;

    const { result } = renderHook(() => useCurrentUser());

    // AuthGate shows the picker in this state; this is the safety net under it.
    expect(result.current).toEqual({ displayName: "Unknown user", email: "", lookupId: 0 });
    expect(api.resolveMyIdentity).not.toHaveBeenCalled();
  });

  it("takes the ONE cached account as unambiguous before it is activated", () => {
    msal.accounts = [FIRST];
    msal.activeAccount = null;

    const { result } = renderHook(() => useCurrentUser());

    expect(result.current.email).toBe("first.person@altronic-llc.com");
  });

  it("asks /me for the mailbox once an account is known", async () => {
    msal.accounts = [FIRST];
    msal.activeAccount = FIRST;

    renderHook(() => useCurrentUser());

    await waitFor(() => expect(api.resolveMyIdentity).toHaveBeenCalledTimes(1));
  });
});

describe("useCurrentUserEmails", () => {
  it("reads the token claims of the ACTIVE account", () => {
    msal.accounts = [FIRST, { ...SECOND, idTokenClaims: { email: "Second.Mailbox@altronic-llc.com" } } as never];
    msal.activeAccount = SECOND;

    const { result } = renderHook(() => useCurrentUserEmails());

    expect(result.current).toEqual([
      "second.person@altronic-llc.com",
      "second.mailbox@altronic-llc.com",
    ]);
  });

  it("is empty when two accounts are cached and none has been chosen", () => {
    msal.accounts = [FIRST, SECOND];
    msal.activeAccount = null;

    const { result } = renderHook(() => useCurrentUserEmails());

    expect(result.current).toEqual([]);
  });
});
