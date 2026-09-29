import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Build Request production hand-off (Ray, 2026-09-29) — the hook wiring:
//   - the write guard in useUpdateBuildRequestFields' mutationFn, so the
//     status picker can't bypass the detail page's button;
//   - which alert fires for which transition, and when the generic
//     "status changed" note is suppressed (a, b, d) or kept (c);
//   - `to !== from` — every "stays quiet" case starts from a fixture ALREADY
//     at the target, the only shape where deleting the guard fails the test.
// =============================================================================

const email = vi.hoisted(() => ({
  fireFieldChangeAlert: vi.fn(),
  fireBuildRequestReadyForProductionAlert: vi.fn(),
  fireBuildRequestPartProductionCompleteAlert: vi.fn(),
  fireBuildRequestProductionCompleteAlert: vi.fn(),
  fireBuildRequestCompleteAlert: vi.fn(),
  fireAssigneeChangeAlert: vi.fn(),
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));
vi.mock("@/api/email", () => email);

const api = vi.hoisted(() => ({
  updateBuildRequestFields: vi.fn(),
  listBuildRequests: vi.fn(),
  updateBuildRequestItemFields: vi.fn(),
  listBuildRequestItems: vi.fn(),
}));
vi.mock("@/api/buildRequests", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  updateBuildRequestFields: api.updateBuildRequestFields,
  listBuildRequests: api.listBuildRequests,
}));
vi.mock("@/api/buildRequestItems", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  updateBuildRequestItemFields: api.updateBuildRequestItemFields,
  listBuildRequestItems: api.listBuildRequestItems,
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({ pushToast: toast }));

const access = vi.hoisted(() => ({
  isAdmin: false,
  emails: ["eng.one@altronic-llc.com"] as string[],
  /** What the Admins LIST holds — the guard awaits it rather than trusting the render-time flag. */
  admins: [] as string[],
}));
vi.mock("@/api/admins", () => ({
  listAdmins: vi.fn(async () => access.admins.map((email) => ({ email, displayName: email }))),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Eng One", email: "eng.one@altronic-llc.com", lookupId: 5 }),
  useCurrentUserEmails: () => access.emails,
}));
vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => access.isAdmin,
  useAdminAccess: () => ({ isAdmin: access.isAdmin, isResolving: false }),
}));

import {
  BUILD_REQUEST_ITEMS_KEY,
  BUILD_REQUESTS_KEY,
  useUpdateBuildRequestFields,
  useUpdateBuildRequestItemFields,
} from "./useBuildRequests";
import type {
  BuildRequest,
  BuildRequestItem,
  BuildRequestPartStatus,
  BuildRequestStatus,
  Person,
} from "@/types/task";

const engineer: Person = { displayName: "Eng One", email: "eng.one@altronic-llc.com", lookupId: 5 };

function br(id: number, status: BuildRequestStatus): BuildRequest {
  return {
    id,
    brNo: `BR_2026-00${id}`,
    title: `Request ${id}`,
    product: "",
    status,
    brType: null,
    blockedReason: null,
    requiredLeadTime: null,
    quotedShipDate: null,
    samplePhase: null,
    requestor: null,
    engineerAssigned: engineer,
    customerName: "",
    customerPO: "",
    leadFree: false,
    watchers: [],
    parentProjects: [],
    taskReferenceLookupId: null,
    createdAt: new Date(),
    modifiedAt: new Date(),
    author: null,
    comments: [],
    hasAttachments: false,
  };
}

function part(id: number, brId: number, partStatus: BuildRequestPartStatus | null): BuildRequestItem {
  return {
    id,
    partNumber: `P-${id}`,
    buildRequestLookupId: brId,
    projectRef: null,
    partDesc: "",
    drawingNo: "",
    drawingRev: "",
    qty: null,
    woNo: "",
    specialInstructions: "",
    testPlan: "",
    opSummary: "",
    serialNos: "",
    revisionDate: "",
    partType: null,
    partStatus,
    disposition: null,
    assembly: [],
    operations: [],
    testing: [],
    checklist: {},
    taskRefLookupId: null,
    watchers: [],
    createdAt: new Date(),
    modifiedAt: new Date(),
    author: null,
    comments: [],
    hasAttachments: false,
  };
}

function setup(brs: BuildRequest[], items: BuildRequestItem[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  qc.setQueryData(BUILD_REQUESTS_KEY, brs);
  qc.setQueryData(BUILD_REQUEST_ITEMS_KEY, items);
  api.listBuildRequests.mockResolvedValue(brs);
  api.listBuildRequestItems.mockResolvedValue(items);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

async function setBrStatus(brs: BuildRequest[], items: BuildRequestItem[], id: number, status: string) {
  const { wrapper, qc } = setup(brs, items);
  const { result } = renderHook(() => useUpdateBuildRequestFields(), { wrapper });
  let error: unknown = null;
  await act(async () => {
    try {
      await result.current.mutateAsync({ id, fields: { BRStatus: status } });
    } catch (e) {
      error = e;
    }
  });
  return { error, qc };
}

async function setPartStatus(brs: BuildRequest[], items: BuildRequestItem[], id: number, status: string) {
  const { wrapper } = setup(brs, items);
  const { result } = renderHook(() => useUpdateBuildRequestItemFields(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ id, fields: { Part_x0020_Status: status } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  access.isAdmin = false;
  access.admins = [];
  access.emails = ["eng.one@altronic-llc.com"];
  api.updateBuildRequestFields.mockResolvedValue(undefined);
  api.updateBuildRequestItemFields.mockResolvedValue(undefined);
});

describe("useUpdateBuildRequestFields — the production write guard", () => {
  it("refuses Ready for Production while a part is not ready, with NO request sent", async () => {
    const { error, qc } = await setBrStatus(
      [br(1, "In-process")],
      [part(10, 1, "Ready for Production"), part(11, 1, "Review Checklist")],
      1,
      "Ready for Production",
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/1 part still needs to reach Ready for Production/);
    expect(api.updateBuildRequestFields).not.toHaveBeenCalled();
    // Nothing was optimistically moved.
    expect(qc.getQueryData<BuildRequest[]>(BUILD_REQUESTS_KEY)?.[0].status).toBe("In-process");
    expect(email.fireBuildRequestReadyForProductionAlert).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: expect.stringMatching(/still needs/) }),
    );
  });

  it("refuses a user who is neither the assigned engineer nor an admin", async () => {
    access.emails = ["someone.else@altronic-llc.com"];
    const { error } = await setBrStatus(
      [br(1, "In-process")],
      [part(10, 1, "Ready for Production")],
      1,
      "Ready for Production",
    );
    expect((error as Error).message).toMatch(/assigned engineer or an ARC admin/);
    expect(api.updateBuildRequestFields).not.toHaveBeenCalled();
  });

  // The render-time flag reads false while the Admins list loads; the guard
  // must await the list instead, or a real admin is refused on first paint.
  it("lets an admin through who is not the engineer, even before the page's admin flag has resolved", async () => {
    access.emails = ["someone.else@altronic-llc.com"];
    access.isAdmin = false;
    access.admins = ["someone.else@altronic-llc.com"];
    const { error } = await setBrStatus(
      [br(1, "In-process")],
      [part(10, 1, "Ready for Production")],
      1,
      "Ready for Production",
    );
    expect(error).toBeNull();
    expect(api.updateBuildRequestFields).toHaveBeenCalledWith(1, { BRStatus: "Ready for Production" });
  });

  it("refuses Production Complete while a part is only Ready for Production", async () => {
    const { error } = await setBrStatus(
      [br(1, "Ready for Production")],
      [part(10, 1, "Production Complete"), part(11, 1, "Ready for Production")],
      1,
      "Production Complete",
    );
    expect((error as Error).message).toMatch(/1 part still needs to reach Production Complete/);
    expect(api.updateBuildRequestFields).not.toHaveBeenCalled();
  });

  it("leaves every other status change ungated", async () => {
    access.emails = ["someone.else@altronic-llc.com"];
    const { error } = await setBrStatus([br(1, "In-process")], [], 1, "Blocked");
    expect(error).toBeNull();
    expect(api.updateBuildRequestFields).toHaveBeenCalled();
  });
});

describe("useUpdateBuildRequestFields — alerts", () => {
  it("a: Ready for Production fires its alert and NOT the generic note", async () => {
    await setBrStatus([br(1, "In-process")], [part(10, 1, "Ready for Production")], 1, "Ready for Production");
    expect(email.fireBuildRequestReadyForProductionAlert).toHaveBeenCalledTimes(1);
    expect(email.fireBuildRequestReadyForProductionAlert.mock.calls[0][0].buildRequest.id).toBe(1);
    expect(email.fireFieldChangeAlert).not.toHaveBeenCalled();
  });

  it("a: re-saving Ready for Production (already there) stays quiet", async () => {
    await setBrStatus(
      [br(1, "Ready for Production")],
      [part(10, 1, "Ready for Production")],
      1,
      "Ready for Production",
    );
    expect(email.fireBuildRequestReadyForProductionAlert).not.toHaveBeenCalled();
  });

  it("c: Production Complete asks the reviewer AND keeps the generic note", async () => {
    await setBrStatus([br(1, "Ready for Production")], [part(10, 1, "Production Complete")], 1, "Production Complete");
    expect(email.fireBuildRequestProductionCompleteAlert).toHaveBeenCalledTimes(1);
    expect(email.fireFieldChangeAlert).toHaveBeenCalledTimes(1);
    expect(email.fireFieldChangeAlert.mock.calls[0][0]).toMatchObject({
      from: "Ready for Production",
      to: "Production Complete",
    });
  });

  it("c: re-saving Production Complete (already there) stays quiet", async () => {
    await setBrStatus([br(1, "Production Complete")], [part(10, 1, "Production Complete")], 1, "Production Complete");
    expect(email.fireBuildRequestProductionCompleteAlert).not.toHaveBeenCalled();
  });

  it("d: Production Complete -> Complete fires the final alert and NOT the generic note", async () => {
    await setBrStatus([br(1, "Production Complete")], [], 1, "Complete");
    expect(email.fireBuildRequestCompleteAlert).toHaveBeenCalledTimes(1);
    expect(email.fireFieldChangeAlert).not.toHaveBeenCalled();
  });

  it("d: Complete from anywhere else keeps the generic note and sends no final alert", async () => {
    await setBrStatus([br(1, "In-process")], [], 1, "Complete");
    expect(email.fireBuildRequestCompleteAlert).not.toHaveBeenCalled();
    expect(email.fireFieldChangeAlert).toHaveBeenCalledTimes(1);
  });

  it("d: re-saving Complete (already there) sends no final alert", async () => {
    await setBrStatus([br(1, "Complete")], [], 1, "Complete");
    expect(email.fireBuildRequestCompleteAlert).not.toHaveBeenCalled();
  });
});

describe("useUpdateBuildRequestItemFields — alert b", () => {
  it("a part reaching Production Complete fires the part alert with its parent, not the generic note", async () => {
    await setPartStatus(
      [br(1, "Ready for Production")],
      [part(10, 1, "Ready for Production")],
      10,
      "Production Complete",
    );
    await waitFor(() =>
      expect(email.fireBuildRequestPartProductionCompleteAlert).toHaveBeenCalledTimes(1),
    );
    const args = email.fireBuildRequestPartProductionCompleteAlert.mock.calls[0][0];
    expect(args.buildRequest.id).toBe(1);
    expect(args.part.id).toBe(10);
    expect(email.fireFieldChangeAlert).not.toHaveBeenCalled();
  });

  it("still reaches the parent request's people when the requests cache is empty", async () => {
    const parent = br(1, "Ready for Production");
    const { wrapper, qc } = setup([parent], [part(10, 1, "Ready for Production")]);
    qc.removeQueries({ queryKey: BUILD_REQUESTS_KEY });
    const { result } = renderHook(() => useUpdateBuildRequestItemFields(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 10, fields: { Part_x0020_Status: "Production Complete" } });
    });
    await waitFor(() =>
      expect(email.fireBuildRequestPartProductionCompleteAlert).toHaveBeenCalledTimes(1),
    );
    expect(email.fireBuildRequestPartProductionCompleteAlert.mock.calls[0][0].buildRequest.id).toBe(1);
    expect(email.fireFieldChangeAlert).not.toHaveBeenCalled();
  });

  it("re-saving a part already Production Complete stays quiet", async () => {
    await setPartStatus(
      [br(1, "Ready for Production")],
      [part(10, 1, "Production Complete")],
      10,
      "Production Complete",
    );
    expect(email.fireBuildRequestPartProductionCompleteAlert).not.toHaveBeenCalled();
  });

  it("any other part status change keeps the generic note", async () => {
    await setPartStatus([br(1, "In-process")], [part(10, 1, null)], 10, "Ready for Production");
    expect(email.fireBuildRequestPartProductionCompleteAlert).not.toHaveBeenCalled();
    expect(email.fireFieldChangeAlert).toHaveBeenCalledTimes(1);
  });
});
