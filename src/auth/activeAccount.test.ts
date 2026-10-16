import { describe, it, expect } from "vitest";
import type { AccountInfo } from "@azure/msal-browser";
import { resolveAccount } from "./activeAccount";

function account(id: string, username = `${id}@altronic-llc.com`): AccountInfo {
  return {
    homeAccountId: id,
    localAccountId: id,
    environment: "login.microsoftonline.com",
    tenantId: "tenant",
    username,
  } as AccountInfo;
}

const A = account("acct-a");
const B = account("acct-b");

describe("resolveAccount", () => {
  it("returns the active account", () => {
    expect(resolveAccount(A, [A, B])).toBe(A);
  });

  it("returns the cached instance of the active account, not the fresh copy", () => {
    // MSAL hands back a new object from every getActiveAccount() call; React
    // effects keyed on the account must see the same reference each render.
    const freshCopy = { ...B };
    expect(resolveAccount(freshCopy, [A, B])).toBe(B);
  });

  it("falls back to the active account itself when it isn't in the list yet", () => {
    expect(resolveAccount(B, [A])).toBe(B);
  });

  it("treats a single cached account as unambiguous", () => {
    expect(resolveAccount(null, [A])).toBe(A);
  });

  // The shared-workstation case (Ray, 2026-09-02): two people have signed in
  // on this browser and nobody has chosen. Guessing is the bug.
  it("refuses to pick between two cached accounts", () => {
    expect(resolveAccount(null, [A, B])).toBeNull();
    expect(resolveAccount(undefined, [A, B])).toBeNull();
  });

  it("returns null when nothing is cached", () => {
    expect(resolveAccount(null, [])).toBeNull();
  });
});
