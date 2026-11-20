import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { downloadBlob } from "@/hooks/useQuotePdf";
import { pushToast } from "./Toast";

// =============================================================================
// Export a QC form as its paper sheet. One button for every controlled form:
// the list view exports the BLANK sheet, the edit form the FILLED one — the
// caller's `build` decides which. The PDF is generated in the browser and
// downloaded; nothing is saved anywhere.
// =============================================================================

interface QcFormExportButtonProps {
  label: string;
  /** Builds the file. Rejects with a message worth showing on failure. */
  build: () => Promise<{ blob: Blob; fileName: string }>;
  title?: string;
  disabled?: boolean;
}

export function QcFormExportButton({ label, build, title, disabled }: QcFormExportButtonProps) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const { blob, fileName } = await build();
      downloadBlob(blob, fileName);
    } catch (err) {
      pushToast({
        message: `Couldn't export the form — ${err instanceof Error ? err.message : String(err)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || busy}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      {label}
    </button>
  );
}
