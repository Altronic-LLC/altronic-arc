import { describe, expect, it } from "vitest";
import {
  filesFromClipboard,
  isGeneratedScreenshotName,
  screenshotFilename,
} from "./pasteFiles";

/**
 * Minimal stand-in for the DataTransfer a paste event carries. jsdom doesn't
 * implement a constructible DataTransfer with files, so we hand-roll the two
 * bits the helper actually reads.
 */
function clipboard(files: File[], text = ""): DataTransfer {
  return {
    files: files as unknown as FileList,
    getData: (type: string) => (type === "text/plain" ? text : ""),
  } as unknown as DataTransfer;
}

const png = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

describe("screenshotFilename", () => {
  it("stamps the date and time so two screenshots never collide", () => {
    const at = new Date(2026, 7, 11, 13, 45, 2); // 11 Aug 2026, 13:45:02
    expect(screenshotFilename("image/png", at)).toBe("screenshot-2026-08-11-134502.png");
  });

  it("keeps the right extension per image type, defaulting to png", () => {
    const at = new Date(2026, 0, 1, 0, 0, 0);
    expect(screenshotFilename("image/jpeg", at)).toMatch(/\.jpg$/);
    expect(screenshotFilename("image/gif", at)).toMatch(/\.gif$/);
    expect(screenshotFilename("image/tiff", at)).toMatch(/\.png$/);
  });
});

describe("isGeneratedScreenshotName", () => {
  // The naming prompt only opens for names this module generated. If the
  // generator's format and this predicate ever drift apart, the prompt stops
  // appearing and screenshots silently go in unnamed again — so round-trip
  // every image type the generator supports rather than testing one literal.
  it("recognises every name screenshotFilename can produce", () => {
    const at = new Date(2026, 7, 11, 13, 45, 2);
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/bmp",
      "image/svg+xml",
      "image/tiff", // falls back to .png
    ]) {
      expect(isGeneratedScreenshotName(screenshotFilename(type, at))).toBe(true);
    }
  });

  it("does not claim names a person or File Explorer supplied", () => {
    expect(isGeneratedScreenshotName("pump-curve.png")).toBe(false);
    expect(isGeneratedScreenshotName("screenshot.png")).toBe(false);
    expect(isGeneratedScreenshotName("screenshot-2026-08-11.png")).toBe(false);
    // A user who names their file exactly like ours keeps that name — the
    // worst case is one extra prompt they can accept as-is.
    expect(isGeneratedScreenshotName("my screenshot-2026-08-11-134502.png")).toBe(false);
  });
});

describe("filesFromClipboard", () => {
  const at = new Date(2026, 7, 11, 9, 0, 0);

  it("renames an unnamed screenshot so repeated pastes don't collide", () => {
    const out = filesFromClipboard(clipboard([png("image.png")]), at);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("screenshot-2026-08-11-090000.png");
    expect(out[0].type).toBe("image/png");
  });

  it("keeps a real filename when a file is copied from Explorer", () => {
    const out = filesFromClipboard(clipboard([png("pump-curve.png")], "pump-curve.png"), at);
    expect(out.map((f) => f.name)).toEqual(["pump-curve.png"]);
  });

  it("ignores the image Word/Excel bundles alongside copied text", () => {
    // Copying a spreadsheet range puts BOTH text and a picture of it on the
    // clipboard — attaching the picture is never what was meant.
    const out = filesFromClipboard(clipboard([png("image.png")], "Serial\tQty\n1234\t2"), at);
    expect(out).toEqual([]);
  });

  it("returns nothing for a plain text paste", () => {
    expect(filesFromClipboard(clipboard([], "just some words"), at)).toEqual([]);
  });

  it("handles a null clipboard", () => {
    expect(filesFromClipboard(null, at)).toEqual([]);
  });

  it("passes through several pasted files at once", () => {
    const out = filesFromClipboard(
      clipboard([png("a.png"), png("b.png")], "a.png b.png"),
      at,
    );
    expect(out.map((f) => f.name)).toEqual(["a.png", "b.png"]);
  });

  it("treats an empty-named image as a screenshot", () => {
    const out = filesFromClipboard(clipboard([png("")]), at);
    expect(out[0].name).toBe("screenshot-2026-08-11-090000.png");
  });
});
