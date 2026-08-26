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

describe("copyAttachments (real mode)", () => {
  it("copies every file from the source item onto the target item", async () => {
    spFetch
      .mockResolvedValueOnce(attachmentListResponse(["photo.jpg", "report.pdf"]))
      // Downloads — spFetch returns the raw Response for a binary GET.
      .mockResolvedValueOnce({ arrayBuffer: async () => new ArrayBuffer(4) })
      .mockResolvedValueOnce({ FileName: "photo.jpg", ServerRelativeUrl: "/x/photo.jpg" })
      .mockResolvedValueOnce({ arrayBuffer: async () => new ArrayBuffer(8) })
      .mockResolvedValueOnce({ FileName: "report.pdf", ServerRelativeUrl: "/x/report.pdf" });

    const result = await copyAttachments("eir", 42, "task", 7);

    expect(result).toEqual({ copied: ["photo.jpg", "report.pdf"], failed: [] });
    // list, download+upload, download+upload = 5 calls
    expect(spFetch).toHaveBeenCalledTimes(5);
  });

  it("keeps going and reports which files failed, without throwing", async () => {
    spFetch
      .mockResolvedValueOnce(attachmentListResponse(["ok.jpg", "bad.pdf"]))
      .mockResolvedValueOnce({ arrayBuffer: async () => new ArrayBuffer(4) })
      .mockResolvedValueOnce({ FileName: "ok.jpg", ServerRelativeUrl: "/x/ok.jpg" })
      .mockRejectedValueOnce(new Error("SharePoint 403"));

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
