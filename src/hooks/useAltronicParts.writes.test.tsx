import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
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
  useApproveAltronicPart,
  useCreateAltronicComponent,
  useCreateAltronicPart,
  useDeleteAltronicComponent,
  useDeleteAltronicPart,
  useRequestNewPartsList,
  useSuggestPartCorrection,
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
    await act(() =>
      expect(result.current.mutateAsync({ id: 9, patch: { sapNumber: "X" } })).rejects.toThrow(
        /only be edited by parts editors/,
      ),
    );
    expect((await listAltronicParts()).find((p) => p.id === 9)?.sapNumber).toBe("");
  });

  it("refuses an HCO edit from a plain editor", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateAltronicComponent(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ id: 1, patch: { notes: "x" } })).rejects.toThrow(/parts editors/),
    );
  });

  it("refuses a Part List edit from a plain editor too — adding isn't editing", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateAltronicPart(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ id: 9, patch: { sapNumber: "X" } })).rejects.toThrow(
        /Suggest a correction/,
      ),
    );
    expect((await listAltronicParts()).find((p) => p.id === 9)?.sapNumber).toBe("");
  });

  it("refuses a 722 add from a plain editor, but allows a 701", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicComponent(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ partNumber: "722900" })).rejects.toThrow(/722/),
    );
    await act(() =>
      expect(result.current.mutateAsync({ partNumber: "701900", description: "RESISTOR" })).resolves.toMatchObject({
        partNumber: "701900",
      }),
    );
  });

  it("refuses the engineering step from an SAP admin", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useApproveAltronicComponent(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ id: 17, expected: "Pending Engineering Review", comment: "" })).rejects.toThrow(/reviewing engineer/),
    );
    expect((await listAltronicComponents()).find((c) => c.id === 17)?.signOffStatus).toBe(
      "Pending Engineering Review",
    );
  });

  it("refuses an engineer starting a new list, and writes nothing", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), SHEILA]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicPart(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ partNumber: "411001", description: "Bracket" })).rejects.toThrow(
        /only the SAP admin can start a new list/,
      ),
    );
    expect((await listAltronicParts()).some((p) => p.partNumber === "411001")).toBe(false);
  });

  it("lets the SAP admin start a new list", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicPart(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ partNumber: "411001", description: "Bracket" })).resolves.toMatchObject({
        partNumber: "411001",
      }),
    );
  });

  it("won't add a Part List part under an HCO list number", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicPart(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ partNumber: "601900" })).rejects.toThrow(/HCO component list/),
    );
  });
});

describe("who hears about it", () => {
  it("a new part goes to the SAP admins", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN, SHEILA]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicPart(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync({ partNumber: "604700", description: "Connector" }));
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    expect(lastRecipients()).toEqual([SHEILA.email]);
  });

  it("a new component goes to the reviewing engineers — not the SAP admins yet", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN, SHEILA]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicComponent(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync({ partNumber: "701900", description: "RESISTOR" }));
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    expect(lastRecipients()).toEqual([GLENN.email]);
  });

  it("a finished engineering review goes to the SAP admins", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["reviewing engineer"]), SHEILA]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useApproveAltronicComponent(), { wrapper: Wrapper });
    await act(() =>
      result.current.mutateAsync({ id: 17, expected: "Pending Engineering Review", comment: "OK" }),
    );
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    expect(lastRecipients()).toEqual([SHEILA.email]);
  });

  it("the SAP admin's email after an engineering review is the new-part email, plus the reviewer's comments", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["reviewing engineer"]), SHEILA]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useApproveAltronicComponent(), { wrapper: Wrapper });
    const updated = await act(() =>
      result.current.mutateAsync({
        id: 17,
        expected: "Pending Engineering Review",
        comment: "Footprint checked against the datasheet",
      }),
    );
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    const email = (
      notifyChangeEmails.mock.calls.at(-1) as unknown as [
        { emails: Array<{ subject: string; headlineHtml: string; detailHtml: string; actions: Array<{ query: string }> }> },
      ]
    )[0].emails[0];
    expect(email.subject).toBe(`New Part to Add to SAP | ${updated.partNumber} | ${updated.description}`);
    expect(email.headlineHtml).toContain("Engineering review approved by");
    expect(email.detailHtml).toContain("Footprint checked against the datasheet");
    for (const label of ["Altronic Part Number", "Mfg Name", "Mfg Number", "Tolerance", "Temp Min", "Temp Max", "Footprint", "Date Created"]) {
      expect(email.detailHtml).toContain(`${label}:`);
    }
    expect(email.actions.map((a) => a.query)).toEqual(["sap=added", "sap=not-needed", "sap=more-info"]);
  });

  it("the new-component email names every field, ratings by what they mean", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicComponent(), { wrapper: Wrapper });
    await act(() =>
      result.current.mutateAsync({ partNumber: "701900", description: "RESISTOR - FILM", ratingA: "4K7" }),
    );
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    const detail = (notifyChangeEmails.mock.calls.at(-1) as unknown as [{ emails: Array<{ detailHtml: string }> }])[0]
      .emails[0].detailHtml;
    expect(detail).toContain("Resistance (Rating A): <strong>4K7</strong>");
    expect(detail).toContain("Power (Rating C):");
  });

  it("the SAP admin's answer goes back to whoever added the part", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useApproveAltronicPart(), { wrapper: Wrapper });
    // Mock part 23 was added by Brandon and is Pending SAP.
    const updated = await act(() =>
      result.current.mutateAsync({ id: 23, expected: "Pending SAP", comment: "", response: "not-needed" }),
    );
    expect(updated.signOffStatus).toBe("Approved");
    expect(updated.comments[0].bodyHtml).toContain("Does not need to be added to SAP — approved.");
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    expect(lastRecipients()).toEqual(["brandon.mirto@altronic-llc.com"]);
    const subject = (notifyChangeEmails.mock.calls.at(-1) as unknown as [{ emails: Array<{ subject: string }> }])[0]
      .emails[0].subject;
    expect(subject).toMatch(/^Approved — not added to SAP:/);
  });

  it("refuses 'more information' with no note saying what, and approves nothing", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useApproveAltronicPart(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ id: 23, expected: "Pending SAP", comment: "  ", response: "more-info" })).rejects.toThrow(/what information is needed/),
    );
    expect((await listAltronicParts()).find((p) => p.id === 23)?.signOffStatus).toBe("Pending SAP");
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("the new-part email lists every field and carries the three answers", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), SHEILA]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicPart(), { wrapper: Wrapper });
    await act(() =>
      result.current.mutateAsync({ partNumber: "604700", description: "Connector", assignedBy: "Matthew Traina" }),
    );
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    const email = (
      notifyChangeEmails.mock.calls.at(-1) as unknown as [
        { emails: Array<{ subject: string; detailHtml: string; actions: Array<{ query: string }> }> },
      ]
    )[0].emails[0];
    expect(email.subject).toBe("New Part to Add to SAP | 604700 | Connector");
    for (const label of ["Altronic Part Number", "MFG Part Number", "Manufacturer", "Drawing Size", "Prototype or Production", "Note", "Date Assigned", "Date Created"]) {
      expect(email.detailHtml).toContain(`${label}:`);
    }
    expect(email.detailHtml).toContain("Matthew Traina");
    expect(email.actions.map((a) => a.query)).toEqual(["sap=added", "sap=not-needed", "sap=more-info"]);
  });

  it("a request for a new list goes to the SAP admins, linking to its Parts Book", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN, SHEILA]);
    notifyChangeEmails.mockImplementationOnce((async ({ emails }: { emails: Array<{ email: string }> }) => ({
      sent: emails.map((e) => e.email),
      failed: [],
    })) as never);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useRequestNewPartsList(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ prefix: "411", partNumber: "411001", description: "Bracket" })).resolves.toEqual(["Sheila Horn"]),
    );
    expect(lastRecipients()).toEqual([SHEILA.email]);
    const call = (notifyChangeEmails.mock.calls.at(-1) as unknown as [
      { emails: Array<{ subject: string; detailHtml: string }>; link: { url: string } },
    ])[0];
    expect(call.emails[0].subject).toBe("New parts list requested: 411");
    expect(call.emails[0].detailHtml).toContain("411001");
    expect(call.link.url).toMatch(/\/engineering\/parts\?book=4$/);
  });

  it("a new-list request with no SAP admin on the list says so rather than 'sent'", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useRequestNewPartsList(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ prefix: "411", partNumber: "411001", description: "" })).rejects.toThrow(/Nobody holds the SAP admin role/),
    );
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("the final approval with no answer emails nobody", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["sap admin"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useApproveAltronicComponent(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync({ id: 18, expected: "Pending SAP", comment: "" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("an edit doesn't reset approval, and tells the SAP admins what changed", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["hco editor"]), SHEILA]);
    const { qc, Wrapper } = wrapper();
    // The diff is taken against the cached row, as on the real page.
    qc.setQueryData(["altronicParts"], await listAltronicParts());
    const { result } = renderHook(() => useUpdateAltronicPart(), { wrapper: Wrapper });
    // Mock part 24 is Approved.
    const updated = await act(() =>
      result.current.mutateAsync({ id: 24, patch: { notes: "Revised harness length" } }),
    );
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
    await act(() => result.current.mutateAsync({ id: 24, patch: { sapNumber: "1027-5512-01" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("follows the role list at send time — a newly tagged SAP admin gets the next email", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateAltronicPart(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync({ partNumber: "604701", description: "A" }));
    await new Promise((r) => setTimeout(r, 50));
    // Nobody holds SAP admin, so there's nobody to tell.
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });
});

describe("suggesting a correction", () => {
  const sent = () =>
    notifyChangeEmails.mockImplementationOnce((async ({ emails }: { emails: Array<{ email: string }> }) => ({
      sent: emails.map((e) => e.email),
      failed: [],
    })) as never);

  it("emails the reviewing engineers and the SAP admins, and changes nothing on the part", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN, SHEILA]);
    sent();
    const part = (await listAltronicParts()).find((p) => p.id === 24)!;
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useSuggestPartCorrection(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ part, component: false, message: "Harness length is 12in, not 10in" })).resolves.toEqual(["Glenn Terry", "Sheila Horn"]),
    );
    expect(lastRecipients()).toEqual([GLENN.email, SHEILA.email].sort());
    const email = (notifyChangeEmails.mock.calls.at(-1) as unknown as [{ emails: Array<{ subject: string; detailHtml: string }> }])[0]
      .emails[0];
    expect(email.subject).toMatch(/^Correction suggested:/);
    expect(email.detailHtml).toContain("Harness length is 12in, not 10in");
    expect((await listAltronicParts()).find((p) => p.id === 24)).toEqual(part);
  });

  it("is refused inside the mutation for somebody who can edit, or has no role", async () => {
    const part = (await listAltronicParts()).find((p) => p.id === 24)!;
    for (const roles of [["hco editor"], []] as PartsRoleEntry["roles"][]) {
      __resetPartsRolesMockStore([role(1, DEMO, "Demo User", roles), GLENN, SHEILA]);
      const { Wrapper } = wrapper();
      const { result } = renderHook(() => useSuggestPartCorrection(), { wrapper: Wrapper });
      await act(() =>
        expect(result.current.mutateAsync({ part, component: false, message: "x" })).rejects.toThrow(),
      );
    }
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("refuses an empty message", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"]), GLENN, SHEILA]);
    const part = (await listAltronicParts()).find((p) => p.id === 24)!;
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useSuggestPartCorrection(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ part, component: false, message: "  " })).rejects.toThrow(/what should change/),
    );
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });

  it("says so when there's nobody to tell, rather than 'sent'", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["editor"])]);
    const part = (await listAltronicParts()).find((p) => p.id === 24)!;
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useSuggestPartCorrection(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ part, component: false, message: "x" })).rejects.toThrow(/nobody to tell/),
    );
  });
});

describe("deleting a part number", () => {
  it("is refused inside the mutation for anybody but the SAP admin — HCO editors and reviewers included", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["reviewing engineer"])]);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useDeleteAltronicPart(), { wrapper: Wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ id: 4, partNumber: "204602", reason: "x" })).rejects.toThrow(/Only the SAP admin/),
    );
    // Read inside act(): the refused mutation is still settling in the mounted hook.
    expect((await act(() => listAltronicParts())).find((p) => p.id === 4)?.signOffStatus).toBeNull();

    const comp = renderHook(() => useDeleteAltronicComponent(), { wrapper: Wrapper });
    await act(() =>
      expect(comp.result.current.mutateAsync({ id: 5, partNumber: "601466", reason: "x" })).rejects.toThrow(/Only the SAP admin/),
    );
    expect((await act(() => listAltronicComponents())).find((c) => c.id === 5)?.signOffStatus).not.toBe("Deleted");
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

    await act(() =>
      result.current.del.mutateAsync({ id: 4, partNumber: "204602", reason: "Raised by mistake" }),
    );
    await waitFor(() => expect(result.current.live.data!.some((p) => p.id === 4)).toBe(false));
    expect(result.current.all.data!.find((p) => p.id === 4)?.signOffStatus).toBe("Deleted");
    // Deleting tells nobody: the SAP admin IS the person who'd be told.
    expect(notifyChangeEmails).not.toHaveBeenCalled();
  });
});
