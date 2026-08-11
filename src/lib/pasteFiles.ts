// =============================================================================
// Pulling files out of a paste.
//
// Ctrl+V carries files in `clipboardData.files` — a screenshot from Win+Shift+S
// or the Snipping Tool, an image copied from a browser, or a file copied in
// File Explorer. Two wrinkles make this more than a one-liner:
//
//   1. A screenshot has NO filename. Browsers hand it over as "image.png" (or
//      an empty name), so pasting three screenshots into one comment would
//      produce three attachments called "image.png" — and SharePoint would
//      either collide or silently rename them to image1/image2. We rename each
//      one to a timestamped `screenshot-<date>-<time>.png` instead, which is
//      both unique and tells you when it was taken.
//
//   2. Copying text out of Word or Excel puts an IMAGE of the selection on the
//      clipboard alongside the text. Treating that as a file attaches a
//      screenshot of the words the user meant to paste as text. So when the
//      paste carries usable text, images are ignored and the text wins.
// =============================================================================

/** Extension to use per clipboard image type; anything else falls back to png. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

/**
 * Recognises a name this module generated, as opposed to one the user or File
 * Explorer supplied. Lives HERE, next to the generator, on purpose: the naming
 * prompt keys off it to decide whether to interrupt the paste, and if the two
 * ever drifted apart the prompt would silently stop appearing — the failure
 * mode being that screenshots quietly go in unnamed again. `pasteFiles.test.ts`
 * round-trips the generator through this predicate to keep them honest.
 */
export function isGeneratedScreenshotName(name: string): boolean {
  return /^screenshot-\d{4}-\d{2}-\d{2}-\d{6}\.[a-z0-9+]+$/i.test(name.trim());
}

/** `screenshot-2026-08-11-134502.png` — sortable, unique per second. */
export function screenshotFilename(contentType: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = IMAGE_EXTENSIONS[contentType] ?? "png";
  return `screenshot-${stamp}.${ext}`;
}

/**
 * True when a pasted file arrived without a real name of its own — the
 * screenshot case. Browsers vary: Chrome says "image.png", Firefox has used
 * "" and "unknown", Safari "image.tiff".
 */
function isUnnamed(file: File): boolean {
  const name = file.name.trim().toLowerCase();
  return !name || name === "unknown" || /^image\.\w+$/.test(name);
}

/**
 * Files to attach from a paste, or [] when the paste is ordinary text.
 *
 * Pass the event's `clipboardData`. Returns real `File` objects ready for the
 * same upload path drag-drop uses, with screenshots renamed (see the note at
 * the top of this file).
 */
export function filesFromClipboard(
  data: DataTransfer | null,
  now: Date = new Date(),
): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length === 0) return [];

  // Text wins over the image Office/browsers helpfully bundle alongside it.
  // Only bail for genuinely unnamed images — pasting a REAL file from File
  // Explorer also carries its name as text, and that one should attach.
  const text = data.getData?.("text/plain") ?? "";
  if (text.trim() && files.every((f) => f.type.startsWith("image/") && isUnnamed(f))) {
    return [];
  }

  return files.map((file) =>
    isUnnamed(file) && file.type.startsWith("image/")
      ? new File([file], screenshotFilename(file.type, now), {
          type: file.type,
          lastModified: file.lastModified,
        })
      : file,
  );
}
