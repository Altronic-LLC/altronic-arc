import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphError } from "./graph";

// A list-item attachment goes up in ONE request (SharePoint has no chunked
// attachment API). When a large file is cut off mid-way the browser throws a
// bare TypeError ("Failed to fetch"); it must reach the user as a sentence
// that says what happened, not as ARC looking broken (Ray, 2026-09-29).
//
// And two uploads to one item must never overlap: SharePoint stores the file
// and then refuses the item update with a 500, so the upload "fails" with the
// file already there — which sent Save Failed emails for saves that had worked
// (2026-10-22).

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

const SP_500 = new GraphError(
  500,
  "Internal Server Error",
  '{"odata.error":{"code":"-2147467259, Microsoft.SharePoint.SPException","message":{"lang":"en-US","value":"Cannot complete this action.\\n\\nPlease try again."}}}',
  "https://contoso.sharepoint.com/sites/Eng/_api/x",
);

const isPost = (init?: RequestInit) => init?.method === "POST";
const listing = (...names: string[]) => ({
  value: names.map((n) => ({ FileName: n, ServerRelativeUrl: `/sites/Eng/Lists/EIRs/Attachments/7/${n}` })),
});

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
    spFetch.mockImplementation(async (_path: string, init?: RequestInit) =>
      isPost(init) ? { FileName: "scan.pdf", ServerRelativeUrl: "/sites/Eng/x/scan.pdf" } : listing(),
    );
    await uploadAttachment("eir", 7, FILE);
    const posts = spFetch.mock.calls.filter(([, init]) => isPost(init));
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toContain("/items(7)/AttachmentFiles/add(FileName='scan.pdf')");
  });

  it("treats a 500 as saved when the file is there afterwards and wasn't before", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let posted = false;
    spFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (isPost(init)) {
        posted = true;
        throw SP_500;
      }
      return posted ? listing("other.png", "scan.pdf") : listing("other.png");
    });
    const result = await uploadAttachment("eir", 7, FILE);
    expect(result.fileName).toBe("scan.pdf");
    warn.mockRestore();
  });

  it("still fails a 500 when the file isn't there afterwards", async () => {
    spFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (isPost(init)) throw SP_500;
      return listing("other.png");
    });
    await expect(uploadAttachment("eir", 7, FILE)).rejects.toBe(SP_500);
  });

  it("still fails when a file of that name was ALREADY there — it may not be this one", async () => {
    spFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (isPost(init)) throw SP_500;
      return listing("scan.pdf");
    });
    await expect(uploadAttachment("eir", 7, FILE)).rejects.toBe(SP_500);
  });

  it("never checks after a plain refusal (403) — nothing was written", async () => {
    const refused = new GraphError(403, "Forbidden", "{}", "u");
    let posted = false;
    spFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (isPost(init)) {
        posted = true;
        throw refused;
      }
      return posted ? listing("scan.pdf") : listing();
    });
    await expect(uploadAttachment("eir", 7, FILE)).rejects.toBe(refused);
  });

  it("uploads several files to ONE item one at a time, never overlapping", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    spFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (!isPost(init)) return listing();
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const name = decodeURIComponent(/FileName='([^']+)'/.exec(path)![1]);
      return { FileName: name, ServerRelativeUrl: `/x/${name}` };
    });
    const files = ["a.pdf", "b.pdf", "c.pdf"].map((n) => new File(["x"], n));
    const results = await Promise.all(files.map((f) => uploadAttachment("eir", 7, f)));
    expect(results.map((r) => r.fileName)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(maxInFlight).toBe(1);
  });

  it("keeps the queue moving after a failed upload", async () => {
    spFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (!isPost(init)) return listing();
      if (path.includes("bad.pdf")) throw new GraphError(400, "Bad Request", "{}", "u");
      return { FileName: "good.pdf", ServerRelativeUrl: "/x/good.pdf" };
    });
    const bad = uploadAttachment("eir", 7, new File(["x"], "bad.pdf"));
    const good = uploadAttachment("eir", 7, new File(["x"], "good.pdf"));
    await expect(bad).rejects.toBeInstanceOf(GraphError);
    await expect(good).resolves.toMatchObject({ fileName: "good.pdf" });
  });
});
