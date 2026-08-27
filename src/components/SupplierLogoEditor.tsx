import { useRef } from "react";
import type { Supplier } from "@/types/task";
import { useClearSupplierLogo, useUpdateSupplierLogo } from "@/hooks/useSuppliers";
import { pushToast } from "./Toast";
import { SupplierLogo } from "./SupplierLogo";

// A company logo is small; 5MB is generous headroom while still catching a
// mis-picked multi-megapixel photo before it burns an upload round trip.
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

interface SupplierLogoEditorProps {
  supplier: Supplier;
}

/**
 * The Logo tile on the supplier detail page, with Change/Remove text links
 * underneath it — the same "plain display + one small explicit action"
 * shape as every other editable field on this page (see `EditButton` in
 * `SupplierDetailView.tsx`), rather than a hover-only camera-icon overlay,
 * which is invisible on a touch device with no hover state at all.
 *
 * Kept as its own component, separate from the plain `SupplierLogo` display
 * the LIST view also renders (up to 150 rows at once) — the list never needs
 * the mutation hooks or the file input this pulls in.
 */
export function SupplierLogoEditor({ supplier }: SupplierLogoEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const updateLogo = useUpdateSupplierLogo();
  const clearLogo = useClearSupplierLogo();
  const busy = updateLogo.isPending || clearLogo.isPending;

  function handlePick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      pushToast({ message: "Choose an image file for the logo.", variant: "error" });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      pushToast({ message: "That image is too large — choose one under 5MB.", variant: "error" });
      return;
    }
    updateLogo.mutate({ current: supplier, file });
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <SupplierLogo supplierId={supplier.id} logo={supplier.logo} className="h-10 w-10 rounded-lg" />
      <div className="flex items-center gap-1 text-[10px] font-medium text-fg-muted">
        {busy ? (
          <span>{clearLogo.isPending ? "Removing…" : "Uploading…"}</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="hover:text-accent hover:underline"
            >
              {supplier.logo ? "Change" : "Add logo"}
            </button>
            {supplier.logo && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => clearLogo.mutate(supplier)}
                  className="hover:text-cooper-red hover:underline"
                >
                  Remove
                </button>
              </>
            )}
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={supplier.logo ? "Change logo" : "Add logo"}
        onChange={(e) => {
          handlePick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
