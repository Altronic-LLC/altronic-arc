import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Attachments on a PM schedule, in REAL mode.
//
// The whole of this feature is the PARENT_CONFIG entry: which list id, and
// which classic SharePoint site root the `_api/` path is built against. Both
// are invisible from mock mode (which never builds a URL at all) and both are
// silently wrong rather than loudly broken if mis-set — a schedule pointed at
// the work-order list would happily list, upload to, and DELETE from the wrong
// list's items. So this asserts the request URL, which IS the thing that could
// be wrong.
//
// Scheduled Maintenance lives on the PMO site, next door to the work orders
// and the equipment list. Attachments were already enabled on the list in
// SharePoint, so nothing there needed creating.
// =============================================================================

const spFetch = vi.hoisted(() => vi.fn());

vi.mock("./sharepoint", () => ({
  spFetch,
  SharePointUnavailableError: class SharePointUnavailableError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    // Force the REAL branch — the mock branch builds no URL to check.
    USE_MOCK: false,
    SP_SCHEDULED_MAINTENANCE_LIST_ID: "schedule-list",
    SP_MAINTENANCE_TASKS_LIST_ID: "work-order-list",
    SP_PMO_SITE_URL: "https://example.sharepoint.com/sites/Altronic_PMO",
    SP_SITE_URL: "https://example.sharepoint.com/sites/Altronic_Engineering",
  };
});

const {
  deleteAttachment,
  listAttachments,
  uploadAttachment,
} = await import("./attachments");

beforeEach(() => {
  spFetch.mockReset();
});

describe("scheduledMaintenance attachments (real mode)", () => {
  it("lists from the Scheduled Maintenance list on the PMO site", async () => {
    spFetch.mockResolvedValue({
      value: [{ FileName: "AJAX manual.pdf", ServerRelativeUrl: "/sites/Altronic_PMO/x.pdf" }],
    });

    const files = await listAttachments("scheduledMaintenance", 41);

    const [path] = spFetch.mock.calls[0];
    expect(path).toBe(
      "https://example.sharepoint.com/sites/Altronic_PMO" +
        "/_api/web/lists(guid'schedule-list')/items(41)/AttachmentFiles",
    );
    expect(files[0].fileName).toBe("AJAX manual.pdf");
  });

  it("does NOT point at the work-order list", async () => {
    spFetch.mockResolvedValue({ value: [] });
    await listAttachments("scheduledMaintenance", 41);
    expect(spFetch.mock.calls[0][0]).not.toContain("work-order-list");
  });

  it("does NOT point at the Engineering site", async () => {
    spFetch.mockResolvedValue({ value: [] });
    await listAttachments("scheduledMaintenance", 41);
    expect(spFetch.mock.calls[0][0]).not.toContain("Altronic_Engineering");
  });

  it("uploads to the schedule's own item", async () => {
    spFetch.mockResolvedValue({
      FileName: "procedure.pdf",
      ServerRelativeUrl: "/sites/Altronic_PMO/procedure.pdf",
    });

    const file = new File([new Uint8Array([1, 2, 3])], "procedure.pdf");
    const result = await uploadAttachment("scheduledMaintenance", 7, file);

    const [path, init] = spFetch.mock.calls[0];
    expect(path).toBe(
      "https://example.sharepoint.com/sites/Altronic_PMO" +
        "/_api/web/lists(guid'schedule-list')/items(7)" +
        "/AttachmentFiles/add(FileName='procedure.pdf')",
    );
    expect(init.method).toBe("POST");
    expect(result.fileName).toBe("procedure.pdf");
  });

  it("deletes from the schedule's own item", async () => {
    spFetch.mockResolvedValue(undefined);

    await deleteAttachment("scheduledMaintenance", 7, "old manual.pdf");

    const [path, init] = spFetch.mock.calls[0];
    expect(path).toBe(
      "https://example.sharepoint.com/sites/Altronic_PMO" +
        "/_api/web/lists(guid'schedule-list')/items(7)" +
        "/AttachmentFiles/getByFileName('old%20manual.pdf')",
    );
    expect(init.headers["X-HTTP-Method"]).toBe("DELETE");
  });
});

describe("scheduledMaintenance attachments when the list id is unset", () => {
  it("reports the env var to set rather than building a broken URL", async () => {
    vi.resetModules();
    vi.doMock("./config", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./config")>();
      return {
        ...actual,
        USE_MOCK: false,
        SP_SCHEDULED_MAINTENANCE_LIST_ID: undefined,
        SP_PMO_SITE_URL: "https://example.sharepoint.com/sites/Altronic_PMO",
      };
    });
    const fresh = await import("./attachments");
    await expect(fresh.listAttachments("scheduledMaintenance", 1)).rejects.toThrow(
      /VITE_SP_SCHEDULED_MAINTENANCE_LIST_ID/,
    );
    vi.doUnmock("./config");
    vi.resetModules();
  });
});
