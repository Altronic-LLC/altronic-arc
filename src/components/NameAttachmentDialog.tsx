import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { sanitiseFilename } from "@/lib/uniqueFilename";
import { isGeneratedScreenshotName } from "@/lib/pasteFiles";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// A pasted screenshot has no name of its own — `filesFromClipboard` (see
// src/lib/pasteFiles.ts) stamps it with a timestamp so it's at least unique
// and sortable, but "screenshot-2026-08-11-134502.png" tells the next person
// looking at the attachment list nothing about what's actually in it. This
// dialog interrupts the paste to ask the user for a real name before the file
// is attached anywhere — cancelling means the screenshot is never attached.
//
// A file pasted with a real name already (copied from File Explorer, or a
// browser image with a genuine filename) skips this entirely; only names
// `filesFromClipboard` generated itself are recognised here.
// =============================================================================

/**
 * True when `file`'s name is one `filesFromClipboard` generated for a
 * nameless screenshot, rather than a real name the user (or File Explorer,
 * or a browser) already supplied. Only these need the naming prompt.
 *
 * The pattern itself lives beside the generator in src/lib/pasteFiles.ts —
 * a second copy here would rot the moment the generated format changed, and
 * the symptom would be this prompt silently never opening.
 */
export function needsAttachmentName(file: File): boolean {
  return isGeneratedScreenshotName(file.name);
}

/** Split "screenshot-2026-08-11-134502.png" into ["screenshot-2026-08-11-134502", ".png"]. */
function splitNameExtension(filename: string): [string, string] {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return [filename, ""];
  return [filename.slice(0, dot), filename.slice(dot)];
}

interface NameAttachmentDialogProps {
  /** The pasted screenshot awaiting a user-chosen name. */
  file: File;
  /**
   * Called with a new File carrying the sanitised name the user typed
   * (same bytes, type, and lastModified — only the name changes).
   */
  onConfirm: (renamed: File) => void;
  /** Escape, Cancel, or a backdrop click — the paste is discarded, not attached. */
  onCancel: () => void;
}

/**
 * Naming prompt shown before an unnamed screenshot is attached. Styled and
 * dismissed the same way as TaskResolutionModal: role="dialog" overlay,
 * Escape and a clean backdrop click both cancel, and a text-selection drag
 * that merely ends on the backdrop does not (see useOverlayDismiss).
 */
export function NameAttachmentDialog({ file, onConfirm, onCancel }: NameAttachmentDialogProps) {
  const [defaultBase, extension] = useMemo(() => splitNameExtension(file.name), [file]);
  const [value, setValue] = useState(defaultBase);
  const inputRef = useRef<HTMLInputElement>(null);

  // A fresh file (next screenshot in the queue) resets the field to ITS
  // default rather than leaving behind whatever the previous one's name was.
  useEffect(() => {
    setValue(defaultBase);
  }, [defaultBase]);

  // Select-all so typing immediately replaces the generated default instead
  // of requiring the user to clear it first.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [file]);

  const previewUrl = useMemo(
    () => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  // Dismiss on a genuine backdrop click only — see useOverlayDismiss for why
  // a plain onClick on the overlay would lose a selection-drag mid-typing.
  const overlayDismiss = useOverlayDismiss(onCancel);

  const trimmed = value.trim();

  function confirm() {
    if (!trimmed) return;
    // Fall back to the original generated base, not the generic "attachment"
    // default, so a name that sanitises away to nothing still reads as the
    // screenshot it is rather than something unrelated.
    const cleanBase = sanitiseFilename(trimmed, defaultBase);
    onConfirm(
      new File([file], `${cleanBase}${extension}`, {
        type: file.type,
        lastModified: file.lastModified,
      }),
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-attachment-heading"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      {...overlayDismiss}
    >
      <div className="flex w-full max-w-sm flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2
            id="name-attachment-heading"
            className="font-display text-base font-semibold text-fg sm:text-lg"
          >
            Name this screenshot
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 px-4 py-4 sm:px-5 sm:py-5">
          <p className="mb-3 text-sm text-fg-muted">
            Give the pasted screenshot a name before it's attached.
          </p>

          {previewUrl && (
            <img
              src={previewUrl}
              alt="Pasted screenshot preview"
              className="mb-3 h-20 w-20 rounded-md border border-border object-cover"
            />
          )}

          <label
            htmlFor="attachment-name-input"
            className="mb-1.5 block text-xs font-medium text-fg-muted"
          >
            File name
          </label>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
            <input
              ref={inputRef}
              id="attachment-name-input"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-muted focus:outline-none"
            />
            {/* Extension is fixed — the user names the file, not the type. */}
            <span className="shrink-0 text-sm text-fg-muted">{extension}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={trimmed.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Attach
          </button>
        </div>
      </div>
    </div>
  );
}
