import { describe, it, expect, vi, beforeEach } from "vitest";

// A list-item attachment goes up in ONE request (SharePoint has no chunked
// attachment API). When a large file is cut off mid-way the browser throws a
// bare TypeError ("Failed to fetch"); it must reach the user as a sentence
// that says what happened, not as ARC looking broken (Ray, 2026-09-29).

const spFetch = vi.hoisted(() => vi.fn());
vi.mock("./sharepoint", () => ({
  spFetch,
  SharePointUnavailableError: class SharePointUnavailableError extends Error {},
}));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
  SP_EIRS_LIST_ID: "eir-list",
  SP_SITE_URL: "https://contoso.sharepoint.com/sites/Eng",
}));

import { uploadAttachment } from "./attachments";

const FILE = new File([new Uint8Array(12 * 1024 * 1024)], "scan.pdf");

beforeEach(() => {
  // Braces matter: a value returned from beforeEach is run as a teardown, and
  // mockReset() returns the mock — which would then be CALLED after each test.
  spFetch.mockReset();
});

describe("uploadAttachment", () => {
  it("turns a cut-off upload into a plain explanation naming the file and size", async () => {
    spFetch.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(uploadAttachment("eir", 7, FILE)).rejects.toThrow(
      /"scan\.pdf" \(12\.0 MB\) was cut off before SharePoint received all of it/,
    );
  });

  it("passes any other failure through unchanged", async () => {
    const refused = new Error("Graph 403 Forbidden");
    spFetch.mockImplementation(async () => {
      throw refused;
    });
    await expect(uploadAttachment("eir", 7, FILE)).rejects.toBe(refused);
  });

  it("still sends the whole file as one POST to AttachmentFiles/add", async () => {
    spFetch.mockResolvedValue({ FileName: "scan.pdf", ServerRelativeUrl: "/sites/Eng/x/scan.pdf" });
    await uploadAttachment("eir", 7, FILE);
    const [path, init] = spFetch.mock.calls[0];
    expect(path).toContain("/items(7)/AttachmentFiles/add(FileName='scan.pdf')");
    expect(init.method).toBe("POST");
  });
});
