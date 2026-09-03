import { beforeEach, describe, expect, it, vi } from "vitest";

const spFetch = vi.hoisted(() => vi.fn());

vi.mock("./sharepoint", () => ({
  spFetch,
  SharePointUnavailableError: class SharePointUnavailableError extends Error {},
}));

// SP_SITE_URL (Engineering) is deliberately BLANK — not undefined — the exact
// shape that used to crash a Panels/PMO/Sales attachment: an explicitly-set-
// but-empty VITE_SP_SITE_URL bypasses a `??` fallback (only null/undefined
// trigger it), so `new URL("")` threw "Failed to construct 'URL': Invalid
// URL" AFTER the file had already been uploaded to SharePoint successfully.
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SP_SITE_URL: "",
    SP_PANELTEAM_SITE_URL: "https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM",
    SP_PANEL_QC_ISSUES_LIST_ID: "issues-list",
  };
});

import { listAttachments, uploadAttachment } from "./attachments";

beforeEach(() => {
  spFetch.mockReset();
});

describe("attachment download links use the PARENT's own site, not Engineering's", () => {
  it("uploadAttachment builds an absolute downloadUrl from the panel team site even with a blank VITE_SP_SITE_URL", async () => {
    spFetch.mockResolvedValue({
      FileName: "photo.png",
      ServerRelativeUrl: "/sites/ALTRONICPANELTEAM/Lists/PANEL COMPONENT FAILURES/Attachments/5/photo.png",
    });
    const file = new File([new Uint8Array([1, 2, 3])], "photo.png");

    const result = await uploadAttachment("panelQcIssue", 5, file);

    expect(result.downloadUrl).toBe(
      "https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM/Lists/PANEL COMPONENT FAILURES/Attachments/5/photo.png",
    );
  });

  it("listAttachments does the same for every row it returns", async () => {
    spFetch.mockResolvedValue({
      value: [{ FileName: "a.pdf", ServerRelativeUrl: "/sites/ALTRONICPANELTEAM/a.pdf" }],
    });

    const [attachment] = await listAttachments("panelQcIssue", 5);

    expect(attachment.downloadUrl).toBe("https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM/a.pdf");
  });
});
