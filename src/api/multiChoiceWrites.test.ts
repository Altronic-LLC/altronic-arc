import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Every genuine multi-choice column ARC writes, pinned in REAL mode.
//
// Build Request Items was where this was reported (2026-09-24 — Assembly /
// Operations / Testing could not be ticked, `400 invalidRequest`), but the
// same latent bug was in two more modules. These are the columns whose live
// definition reports `choice.displayAs: "checkBoxes"`, confirmed against the
// tenant on 2026-09-24:
//
//   Build Request Items  Assembly, Operations, Testing
//   Suppliers List       CoreCompetency  (+ PrimarySupplyFocus, unconfigured)
//   Customer Notes       CustomerType
//
// Mock mode applies these fields to an in-memory object and never builds a
// request, so this is invisible from a mock-mode test or a rendered page.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SP_SITE_ID: "site-1",
    SP_BUILD_REQUEST_ITEMS_LIST_ID: "bri-list",
    SP_SUPPLIERS_LIST_ID: "sup-list",
    SP_CUSTOMER_NOTES_LIST_ID: "cust-list",
  };
});

vi.mock("./siteUsers", () => ({
  ensureLookupIds: vi.fn(async (_s: string, p: unknown[]) => p),
  ensurePersonLookupId: vi.fn(async () => null),
  resolvePeopleLookupIds: vi.fn(async (_s: string, p: unknown[]) => p),
  resolvePersonLookupId: vi.fn(async () => null),
  resolveSiteUserLookupId: vi.fn(async () => null),
  listSiteUserDirectory: vi.fn(async () => []),
  listSiteUsers: vi.fn(async () => []),
}));

import { updateBuildRequestItemFields } from "./buildRequestItems";
import { updateSupplierDetails } from "./suppliers";
import type { Supplier } from "@/types/task";
import { updateCustomerNoteDetails } from "./customerNotes";

const ANNOTATION = "Collection(Edm.String)";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetch.mockResolvedValue({
    id: "1",
    fields: {},
    createdDateTime: "2026-01-01T00:00:00Z",
    lastModifiedDateTime: "2026-01-01T00:00:00Z",
  });
  graphFetchAll.mockReset();
  graphFetchAll.mockResolvedValue([
    {
      id: "1",
      fields: { Title: "x" },
      createdDateTime: "2026-01-01T00:00:00Z",
      lastModifiedDateTime: "2026-01-01T00:00:00Z",
    },
  ]);
});

/** The body of the write request (PATCH or POST), unwrapped. */
function writtenFields(): Record<string, unknown> {
  const call = (graphFetch.mock.calls as Array<[string, RequestInit | undefined]>).find(
    ([, init]) => init?.method === "PATCH" || init?.method === "POST",
  );
  if (!call) throw new Error("no write was sent");
  const body = JSON.parse(String(call[1]?.body));
  // A create wraps its fields; a PATCH on /fields does not.
  return (body.fields ?? body) as Record<string, unknown>;
}

describe("multi-choice columns carry the annotation in real mode", () => {
  it("Build Request Items — Assembly", async () => {
    await updateBuildRequestItemFields(1, { Assembly: ["Final Assy"] }).catch(() => undefined);
    const f = writtenFields();
    expect(f.Assembly).toEqual(["Final Assy"]);
    expect(f["Assembly@odata.type"]).toBe(ANNOTATION);
  });

  it("Suppliers List — CoreCompetency", async () => {
    // updateSupplierDetails DIFFS against the current row, so it needs one.
    const current = { id: 1, coreCompetencies: [] } as unknown as Supplier;
    await updateSupplierDetails(current, { coreCompetencies: ["Assembly"] }).catch(
      () => undefined,
    );
    const f = writtenFields();
    expect(f.CoreCompetency).toEqual(["Assembly"]);
    expect(f["CoreCompetency@odata.type"]).toBe(ANNOTATION);
  });

  it("Customer Notes — CustomerType", async () => {
    // updateCustomerNoteFields is private; this is the public path that
    // carries customer types (the Details card).
    await updateCustomerNoteDetails(1, { customerTypes: ["OEM"] }).catch(() => undefined);
    const f = writtenFields();
    expect(f.CustomerType).toEqual(["OEM"]);
    expect(f["CustomerType@odata.type"]).toBe(ANNOTATION);
  });

  it("does NOT annotate a single-value choice column on the same list", async () => {
    // Part Status is `displayAs: "dropDownMenu"` and saved fine throughout
    // this bug. Annotating it would break it.
    await updateBuildRequestItemFields(1, { Part_x0020_Status: "On Hold" }).catch(
      () => undefined,
    );
    const f = writtenFields();
    expect(f.Part_x0020_Status).toBe("On Hold");
    expect(Object.keys(f).filter((k) => k.includes("@odata"))).toEqual([]);
  });
});
