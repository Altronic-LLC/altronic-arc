import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The gallery's pictures in REAL mode (Application Photos, 2026-11-24).
//
// SharePoint's thumbnail service is asked first (small, and a JPEG even for an
// iPhone HEIC). Whether it accepts ARC's token couldn't be proven from a
// developer machine, so any refusal falls back to the file's own download
// link — and the refusal is REMEMBERED, so a folder of photos doesn't ask the
// service once per tile.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const fetchSharePointThumbnail = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => {
  class GraphError extends Error {
    constructor(
      public status: number,
      public statusText: string,
      public body: string,
      public url: string,
    ) {
      super(`Graph ${status}`);
    }
  }
  return { graphFetch, graphFetchAll: vi.fn(), GraphError };
});

vi.mock("./sharepoint", () => ({ fetchSharePointThumbnail }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false };
});

import { SITES } from "./config";
import { __resetThumbnailRoute, isImageFile } from "./driveLibrary";
import { applicationPhotoImage } from "./applicationPhotos";

const DRIVE = `/sites/${SITES.salesTeam}/drive`;
const THUMB = new Blob(["thumb"], { type: "image/jpeg" });
const realFetch = globalThis.fetch;

beforeEach(() => {
  graphFetch.mockReset();
  fetchSharePointThumbnail.mockReset();
  __resetThumbnailRoute();
  globalThis.fetch = vi.fn(async () => new Response("full")) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Graph's answers: the thumbnail set, then (for a fallback) the download link. */
function graphAnswers() {
  graphFetch.mockImplementation(async (path: string) => {
    if (path.includes("/thumbnails")) {
      return { value: [{ medium: { url: "https://x.svc.ms/transform/thumbnail?m" }, large: { url: "https://x.svc.ms/transform/thumbnail?l" } }] };
    }
    return { "@microsoft.graph.downloadUrl": "https://tenant/_layouts/15/download.aspx?t=1" };
  });
}

describe("applicationPhotoImage (real mode)", () => {
  it("asks for the thumbnail size it needs and fetches it with the SharePoint token", async () => {
    graphAnswers();
    fetchSharePointThumbnail.mockResolvedValue(THUMB);
    const blob = await applicationPhotoImage("item-1", "IMG_0637.JPEG", "large");
    expect(await blob.text()).toBe("thumb");
    expect(graphFetch).toHaveBeenCalledWith(`${DRIVE}/items/item-1/thumbnails?$select=large`);
    expect(fetchSharePointThumbnail).toHaveBeenCalledWith("https://x.svc.ms/transform/thumbnail?l");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("falls back to the file's download link when the thumbnail is refused — and stops asking", async () => {
    graphAnswers();
    fetchSharePointThumbnail.mockRejectedValue(new Error("Thumbnail refused (401)."));
    expect(await (await applicationPhotoImage("item-1", "a.jpg", "medium")).text()).toBe("full");
    expect(globalThis.fetch).toHaveBeenCalledWith("https://tenant/_layouts/15/download.aspx?t=1");

    graphFetch.mockClear();
    fetchSharePointThumbnail.mockClear();
    expect(await (await applicationPhotoImage("item-2", "b.jpg", "medium")).text()).toBe("full");
    expect(fetchSharePointThumbnail).not.toHaveBeenCalled();
    expect(graphFetch.mock.calls.some(([p]) => String(p).includes("/thumbnails"))).toBe(false);
  });

  it("an item with no thumbnail goes straight to the file", async () => {
    graphFetch.mockImplementation(async (path: string) =>
      path.includes("/thumbnails") ? { value: [] } : { "@microsoft.graph.downloadUrl": "https://tenant/d" },
    );
    expect(await (await applicationPhotoImage("item-3", "c.png", "medium")).text()).toBe("full");
    expect(fetchSharePointThumbnail).not.toHaveBeenCalled();
  });
});

describe("isImageFile", () => {
  it("knows pictures by extension, case-blind, including an iPhone's HEIC", () => {
    for (const n of ["a.jpg", "b.JPEG", "c.png", "d.heic", "e.webp", "f.tif"]) expect(isImageFile(n)).toBe(true);
    for (const n of ["notes.pdf", "jpg", "photo.", "x.docx"]) expect(isImageFile(n)).toBe(false);
  });
});
