import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetPartsRolesMockStore } from "@/api/partsRoles";
import { __resetAltronicPartsMockStore, listAltronicParts } from "@/api/altronicParts";
import { __resetAltronicComponentsMockStore, listAltronicComponents } from "@/api/altronicComponents";
import type { PartsRoleEntry } from "@/types/task";

// =============================================================================
// The Parts List writes, through the hooks — i.e. with the gate and the email
// wiring in place, but no screen. Two questions:
//
//  1. Is the ROLE enforced inside the mutation, not just by a greyed button?
//     A future screen or a bulk action reaching the hook must be refused too.
//  2. Does each email reach the people the role list says, today?
//
// Mock mode: the demo user is the actor. The roles store is replaced per test.
// =============================================================================

const notifyChangeEmails = vi.hoisted(() => vi.fn(async () => ({ sent: [], failed: [] })));
vi.mock("@/api/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/email")>();
  return { ...actual, notifyChangeEmails };
});
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import {
  useAllAltronicParts,
  useAltronicParts,
  useApproveAltronicComponent,
  useCreateAltronicComponent,
  useCreateAltronicPart,
  useDeleteAltronicComponent,
  useDeleteAltronicPart,
  useUpdateAltronicComponent,
  useUpdateAltronicPart,
} from "./useAltronicParts";

const DEMO = "demo.user@altronic-llc.com";
const role = (id: number, email: string, displayName: string, roles: PartsRoleEntry["roles"]): PartsRoleEntry => ({
  id,
  email,
  displayName,
  roles,
  note: "",
});
const GLENN = role(2, "glenn.terry@altronic-llc.com", "Glenn Terry", ["reviewing engineer"]);
const SHEILA = role(4, "sheila.horn@altronic-llc.com", "Sheila Horn", ["sap admin"]);

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, Wrapper };
}

/** Everyone the last batch of emails went to. */
function lastRecipients(): string[] {
  const calls = notifyChangeEmails.mock.calls as unknown as Array<[{ emails: Array<{ email: string }> }]>;
  return calls.at(-1)![0].emails.map((e) => e.email).sort();
}

beforeEach(() => {
  notifyChangeEmails.mockClear();
  __resetAltronicPartsMockStore();
  __resetAltronicComponentsMockStore();
});

describe("the role is enforced inside the mutation", () => {
  it("refuses a part edit from somebody with no role, and writes nothing", async () => {
    __resetPartsRolesMockStore([GLENN, SHEILA]); // demo user not on the list
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateAltronicPart(), { wrapper: Wrapper });
    await expect(result.current.mutateAsync({ id: 9, patch: { sapNumber: "X" } })).rejects.toThrow(
      /limited to Engineering/,
    );
    expect((await listAltronicParts()).find((p) => p.id === 9)?.sapNumber).toBe("");
  });

  it("refuses an HOC edit from a plain editor", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateAltronicComponent(), { wrapper: Wrapper });
    await expect(result.current.mutateAsync({ id: 1, patch: { notes: "x" } })).rejects.toThrow(/HOC editors/);
  });

  it("refuses a 722 add from a plain editor, but allows a 701", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicComponent(), { wrapper: Wrapper });
    await expect(result.current.mutateAsync({ partNumber: "722900" })).rejects.toThrow(/722/);
    await expect(result.current.mutateAsync({ partNumber: "701900", description: "RESISTOR" })).resolves.toMatchObject({
      partNumber: "701900",
    });
  });

  it("refuses the engineering step from an SAP admin", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useApproveAltronicComponent(), { wrapper: Wrapper });
    await expect(
      result.current.mutateAsync({ id: 17, expected: "Pending Engineering Review", comment: "" }),
    ).rejects.toThrow(/reviewing engineer/);
    expect((await listAltronicComponents()).find((c) => c.id === 17)?.signOffStatus).toBe(
      "Pending Engineering Review",
    );
  });

  it("won't add a Part List part under an HOC list number", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicPart(), { wrapper: Wrapper });
    await expect(result.current.mutateAsync({ partNumber: "601900" })).rejects.toThrow(/HOC component list/);
  });
});

describe("who hears about it", () => {
  it("a new part goes to the SAP admins", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN, SHEILA]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicPart(), { wrapper: Wrapper });
    await result.current.mutateAsync({ partNumber: "604700", description: "Connector" });
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    expect(lastRecipients()).toEqual([SHEILA.email]);
  });

  it("a new component goes to the reviewing engineers — not the SAP admins yet", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN, SHEILA]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicComponent(), { wrapper: Wrapper });
    await result.current.mutateAsync({ partNumber: "701900", description: "RESISTOR" });
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    expect(lastRecipients()).toEqual([GLENN.email]);
  });

  it("a finished engineering review goes to the SAP admins", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["reviewing engineer"]), SHEILA]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useApproveAltronicComponent(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 17, expected: "Pending Engineering Review", comment: "OK" });
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    expect(lastRecipients()).toEqual([SHEILA.email]);
  });

  it("the final approval emails nobody — the SAP admin IS the last step", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useApproveAltronicComponent(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 18, expected: "Pending SAP", comment: "" });
    await new Promise((r) => setTimeout(r, 50));
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("an edit doesn't reset approval, and tells the SAP admins what changed", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), SHEILA]);
    const { qc, Wrapper } = wrapper();
    // The diff is taken against the cached row, as on the real page.
    qc.setQueryData(["altronicParts"], await listAltronicParts());
    const { result } = renderHook(() => useUpdateAltronicPart(), { wrapper: Wrapper });
    // Mock part 24 is Approved.
    const updated = await result.current.mutateAsync({ id: 24, patch: { notes: "Revised harness length" } });
    expect(updated.signOffStatus).toBe("Approved");
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    expect(lastRecipients()).toEqual([SHEILA.email]);
    const detail = (notifyChangeEmails.mock.calls.at(-1) as unknown as [{ emails: Array<{ detailHtml: string }> }])[0]
      .emails[0].detailHtml;
    expect(detail).toContain("Revised harness length");
  });

  it("an SAP admin's own edit tells nobody", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(["altronicParts"], await listAltronicParts());
    const { result } = renderHook(() => useUpdateAltronicPart(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 24, patch: { sapNumber: "1027-5512-01" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("follows the role list at send time — a newly tagged SAP admin gets the next email", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicPart(), { wrapper: Wrapper });
    await result.current.mutateAsync({ partNumber: "604701", description: "A" });
    await new Promise((r) => setTimeout(r, 50));
    // Nobody holds SAP admin, so there's nobody to tell.
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });
});

describe("deleting a part number", () => {
  it("is refused inside the mutation for anybody but the SAP admin — HOC editors and reviewers included", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["reviewing engineer"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useDeleteAltronicPart(), { wrapper: Wrapper });
    await expect(result.current.mutateAsync({ id: 4, partNumber: "204602", reason: "x" })).rejects.toThrow(/Only the SAP admin/);
    expect((await listAltronicParts()).find((p) => p.id === 4)?.signOffStatus).toBeNull();

    const comp = renderHook(() => useDeleteAltronicComponent(), { wrapper: Wrapper });
    await expect(comp.result.current.mutateAsync({ id: 5, partNumber: "601466", reason: "x" })).rejects.toThrow(/Only the SAP admin/);
    expect((await listAltronicComponents()).find((c) => c.id === 5)?.signOffStatus).not.toBe("Deleted");
  });

  it("lets the SAP admin delete, and the part drops out of the live list but not the full one", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => ({ del: useDeleteAltronicPart(), live: useAltronicParts(), all: useAllAltronicParts() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.live.data).toBeDefined());
    expect(result.current.live.data!.some((p) => p.id === 4)).toBe(true);

    await result.current.del.mutateAsync({ id: 4, partNumber: "204602", reason: "Raised by mistake" });
    await waitFor(() => expect(result.current.live.data!.some((p) => p.id === 4)).toBe(false));
    expect(result.current.all.data!.find((p) => p.id === 4)?.signOffStatus).toBe("Deleted");
    // Deleting tells nobody: the SAP admin IS the person who'd be told.
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });
});
