import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// copyAttachments — used when promoting an EIR to a task, since the EIR's and
// the task's files live in two separate SP REST attachment stores (see the
// "Attachments" section in CLAUDE.md) and nothing links them automatically.
//
// It must be best-effort: one file failing to copy must not lose the ones
// that succeeded, and must not throw — the caller treats a partial or total
// failure as a warning on an otherwise-successful promotion, not a reason to
// fail it (the task the attachments were headed for already exists).
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
    USE_MOCK: false,
    SP_LIST_ID: "task-list",
    SP_EIRS_LIST_ID: "eir-list",
    SP_SITE_URL: "https://contoso.sharepoint.com/sites/Eng",
  };
});

import { copyAttachments } from "./attachments";

function attachmentListResponse(fileNames: string[]) {
  return {
    value: fileNames.map((name) => ({
      FileName: name,
      ServerRelativeUrl: `/sites/Eng/Lists/eir-list/Attachments/1/${name}`,
    })),
  };
}

beforeEach(() => {
  spFetch.mockReset();
});

/**
 * Answer by REQUEST, not by call order: each upload lists the target's
 * attachments first (so an ambiguous failure can be settled by looking), and
 * an ordered list of mocked responses breaks every time that shape changes.
 */
function routeSharePoint(sourceFiles: string[], failDownloadOf?: string) {
  spFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const name = decodeURIComponent(/FileName='([^']+)'/.exec(path)![1]);
      return { FileName: name, ServerRelativeUrl: `/x/${name}` };
    }
    if (path.endsWith("/items(42)/AttachmentFiles")) return attachmentListResponse(sourceFiles);
    if (path.endsWith("/items(7)/AttachmentFiles")) return attachmentListResponse([]);
    // A download of a source file — spFetch returns the raw Response.
    if (failDownloadOf && path.endsWith(failDownloadOf)) throw new Error("SharePoint 403");
    return { arrayBuffer: async () => new ArrayBuffer(4) };
  });
}

const uploads = () =>
  spFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

describe("copyAttachments (real mode)", () => {
  it("copies every file from the source item onto the target item", async () => {
    routeSharePoint(["photo.jpg", "report.pdf"]);

    const result = await copyAttachments("eir", 42, "task", 7);

    expect(result).toEqual({ copied: ["photo.jpg", "report.pdf"], failed: [] });
    expect(uploads().map(([path]) => path)).toEqual([
      expect.stringContaining("/items(7)/AttachmentFiles/add(FileName='photo.jpg')"),
      expect.stringContaining("/items(7)/AttachmentFiles/add(FileName='report.pdf')"),
    ]);
  });

  it("keeps going and reports which files failed, without throwing", async () => {
    routeSharePoint(["ok.jpg", "bad.pdf"], "bad.pdf");

    const result = await copyAttachments("eir", 42, "task", 7);

    expect(result).toEqual({ copied: ["ok.jpg"], failed: ["bad.pdf"] });
  });

  it("does nothing and reports nothing when the source has no attachments", async () => {
    spFetch.mockResolvedValueOnce(attachmentListResponse([]));
    const result = await copyAttachments("eir", 42, "task", 7);
    expect(result).toEqual({ copied: [], failed: [] });
    expect(spFetch).toHaveBeenCalledTimes(1);
  });
});
