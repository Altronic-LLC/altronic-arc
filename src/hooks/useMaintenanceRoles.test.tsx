import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Resolving the signed-in user's CMMS rights.
//
// The cases that matter are the ones that have cost somebody their access
// elsewhere in ARC:
//
//  * **Enforcement off means unrestricted** — the lockout-safety flag.
//  * **An ARC admin is always a maintenance admin**, so a roles list nobody
//    holds `admin` on isn't a door locked from the inside.
//  * **Matching is on EVERY address the account carries**, not the sign-in
//    name. A UPN is not a mailbox, and that is exactly what cost Steven Pirko
//    his EIR role tags (2026-08-20).
// =============================================================================

const mocks = vi.hoisted(() => ({
  enforced: true,
  arcAdmin: false,
  adminResolving: false,
  emails: ["david.bulkley@altronic-llc.com"] as string[],
  entries: [] as unknown[],
  listCalls: 0,
  listRejects: false,
}));

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return {
    ...actual,
    get MAINTENANCE_ROLES_ENFORCED() {
      return mocks.enforced;
    },
  };
});

vi.mock("@/api/maintenanceRoles", () => ({
  listMaintenanceRoles: vi.fn(async () => {
    mocks.listCalls += 1;
    if (mocks.listRejects) throw new Error("Graph 503 Service Unavailable");
    return mocks.entries;
  }),
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "D", email: mocks.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => mocks.emails,
}));

vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => mocks.arcAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.arcAdmin, isResolving: mocks.adminResolving }),
}));

import {
  MAINTENANCE_ROLES_KEY,
  resolveMaintenanceAccess,
  useMyMaintenanceRoles,
} from "./useMaintenanceRoles";

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** Render the hook and wait until it has stopped resolving. */
async function settledRoles(qc = client()) {
  const { result } = renderHook(() => useMyMaintenanceRoles(), { wrapper: wrap(qc) });
  await waitFor(() => expect(result.current.isResolving).toBe(false));
  return result;
}

beforeEach(() => {
  mocks.enforced = true;
  mocks.arcAdmin = false;
  mocks.adminResolving = false;
  mocks.emails = ["david.bulkley@altronic-llc.com"];
  mocks.entries = [];
  mocks.listCalls = 0;
  mocks.listRejects = false;
});

describe("useMyMaintenanceRoles", () => {
  it("reports the tags on the row matching the signed-in user", async () => {
    mocks.entries = [
      { id: 1, email: "someone.else@altronic-llc.com", displayName: "", roles: ["admin"], note: "" },
      { id: 2, email: "david.bulkley@altronic-llc.com", displayName: "D", roles: ["tech"], note: "" },
    ];
    const result = await settledRoles();
    expect(result.current).toEqual({
      isTech: true,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    });
  });

  it("reports nothing held for somebody with no row", async () => {
    mocks.entries = [
      { id: 1, email: "other@altronic-llc.com", displayName: "", roles: ["tech"], note: "" },
    ];
    const result = await settledRoles();
    expect(result.current).toMatchObject({ isTech: false, isAdmin: false, enforced: true });
  });

  // The bug that cost Steven Pirko his EIR roles: the sign-in name (UPN) and
  // the mailbox the list holds are allowed to differ, and in this tenant do.
  it("matches a mailbox that isn't the sign-in name", async () => {
    mocks.emails = [
      "david.bulkley@coopermachineryservices.com",
      "david.bulkley@altronic-llc.com",
    ];
    mocks.entries = [
      { id: 1, email: "David.Bulkley@altronic-llc.com", displayName: "D", roles: ["tech"], note: "" },
    ];
    const result = await settledRoles();
    expect(result.current.isTech).toBe(true);
  });

  it("does not match a different person who shares a first name", async () => {
    mocks.entries = [
      { id: 1, email: "david.phillips@altronic-llc.com", displayName: "", roles: ["admin"], note: "" },
    ];
    const result = await settledRoles();
    expect(result.current.isAdmin).toBe(false);
  });

  // Lockout safety. The whole point of MAINTENANCE_ROLES_ENFORCED.
  it("reports enforced: false, and no wait, when the list isn't configured", () => {
    mocks.enforced = false;
    mocks.entries = [
      { id: 1, email: "david.bulkley@altronic-llc.com", displayName: "", roles: ["tech"], note: "" },
    ];
    const { result } = renderHook(() => useMyMaintenanceRoles(), { wrapper: wrap(client()) });
    expect(result.current.enforced).toBe(false);
    expect(result.current.isResolving).toBe(false);
  });

  it("makes an ARC admin a maintenance admin with no row at all", async () => {
    mocks.arcAdmin = true;
    const result = await settledRoles();
    expect(result.current.isAdmin).toBe(true);
    // ...and a tech, by the same implication: `Roles` is a choice column that
    // may only hold one value per person.
    expect(result.current.isTech).toBe(true);
  });

  it("still reports an ARC admin as admin while enforcement is off", () => {
    mocks.enforced = false;
    mocks.arcAdmin = true;
    const { result } = renderHook(() => useMyMaintenanceRoles(), { wrapper: wrap(client()) });
    // `isTech` too: admin implies tech, and the unenforced path goes through
    // the same factory so it can't report a state the enforced path couldn't.
    expect(result.current).toEqual({
      isTech: true,
      isAdmin: true,
      enforced: false,
      isResolving: false,
    });
  });

  // A denial rendered and then taken back is worse than a beat of "checking".
  it("reports isResolving while the Admins list is still settling", () => {
    mocks.adminResolving = true;
    const { result } = renderHook(() => useMyMaintenanceRoles(), { wrapper: wrap(client()) });
    expect(result.current.isResolving).toBe(true);
  });

  it("does NOT report an ARC admin as resolving — nothing is being waited for", () => {
    mocks.arcAdmin = true;
    mocks.adminResolving = true;
    const { result } = renderHook(() => useMyMaintenanceRoles(), { wrapper: wrap(client()) });
    expect(result.current.isResolving).toBe(false);
    expect(result.current.isAdmin).toBe(true);
  });

  // Only the FIRST match counts, which is why the admin screen refuses to add
  // somebody twice.
  it("reads the first matching row when a duplicate exists", async () => {
    mocks.entries = [
      { id: 1, email: "david.bulkley@altronic-llc.com", displayName: "", roles: [], note: "" },
      { id: 2, email: "david.bulkley@altronic-llc.com", displayName: "", roles: ["admin"], note: "" },
    ];
    const result = await settledRoles();
    expect(result.current.isAdmin).toBe(false);
  });
});

// =============================================================================
// The mutationFn-side resolution. A gated write must NOT answer from a render:
// the roles list loads asynchronously, so a write fired on the first paint
// would refuse a real tech — the false denial this feature exists to prevent,
// moved from the button to the write.
// =============================================================================
describe("resolveMaintenanceAccess", () => {
  it("awaits the list rather than reading whatever is already cached", async () => {
    mocks.entries = [
      { id: 1, email: "david.bulkley@altronic-llc.com", displayName: "", roles: ["tech"], note: "" },
    ];
    const qc = client();
    // Nothing in the cache at all — the render-time answer would be "no tags".
    expect(qc.getQueryData(MAINTENANCE_ROLES_KEY)).toBeUndefined();
    const access = await resolveMaintenanceAccess(qc, mocks.emails, false);
    expect(access).toEqual({
      isTech: true,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    });
  });

  it("reuses a fresh cache entry instead of re-reading", async () => {
    mocks.entries = [
      { id: 1, email: "david.bulkley@altronic-llc.com", displayName: "", roles: ["tech"], note: "" },
    ];
    const qc = client();
    await resolveMaintenanceAccess(qc, mocks.emails, false);
    await resolveMaintenanceAccess(qc, mocks.emails, false);
    expect(mocks.listCalls).toBe(1);
  });

  it("allows everything, and reads nothing, when enforcement is off", async () => {
    mocks.enforced = false;
    const qc = client();
    const access = await resolveMaintenanceAccess(qc, mocks.emails, false);
    expect(access.enforced).toBe(false);
    expect(mocks.listCalls).toBe(0);
  });

  // An ARC admin is allowed everything, so don't spend a request finding out
  // what else they hold. `isTech` is true too — admin implies tech.
  it("answers an ARC admin without reading the list", async () => {
    const qc = client();
    const access = await resolveMaintenanceAccess(qc, mocks.emails, true);
    expect(access).toEqual({
      isTech: true,
      isAdmin: true,
      enforced: true,
      isResolving: false,
    });
    expect(mocks.listCalls).toBe(0);
  });

  // A failed READ is a genuine fault, not the unconfigured state — that is
  // handled by `enforced` before we get here. Waving it through would make the
  // gate advisory; refusing with a retryable message is honest.
  it("refuses, saying it couldn't check, when the list read fails", async () => {
    mocks.listRejects = true;
    await expect(resolveMaintenanceAccess(client(), mocks.emails, false)).rejects.toThrow(
      /Couldn't check your maintenance permissions/i,
    );
  });

  it("keeps the underlying failure in the message so it can be reported", async () => {
    mocks.listRejects = true;
    await expect(resolveMaintenanceAccess(client(), mocks.emails, false)).rejects.toThrow(
      /503/,
    );
  });
});
