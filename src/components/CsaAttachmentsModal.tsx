import { useEffect } from "react";
import { X, Paperclip } from "lucide-react";
import type { CsaListing } from "@/types/task";
import { csaListingLabel } from "@/lib/csaListingMapper";
import { AttachmentsSection } from "./AttachmentsSection";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// A CSA listing's certificates, for ANYONE signed in.
//
// The register's paperclip column was a static icon — it told you a
// certificate existed and gave you no way to open it. The files were only
// reachable inside the Edit modal, which is ADMIN-ONLY, so for everyone else
// the attachment was visible and unreachable (Ray, 2026-09-16: "clicking
// attachment in CSA listings does not work, users need to be able to access
// them").
//
// CSA Listings is the case the `readOnly` prop on `AttachmentsSection` exists
// for: READING a certificate is open to everyone (it is what the register is
// for — chasing which file covers a part number), while adding, replacing and
// deleting stay admin-only. Gating the whole card would have hidden the file;
// gating only the controls is what makes it reachable.
//
// Admins get the same modal WITHOUT `readOnly`, so the register itself is now
// a place to manage the files too, rather than only the Edit form.
// =============================================================================

export function CsaAttachmentsModal({
  listing,
  canEdit,
  onClose,
}: {
  listing: CsaListing;
  /** Admins may add and remove here; everyone else downloads only. */
  canEdit: boolean;
  onClose: () => void;
}) {
  const overlayDismiss = useOverlayDismiss(onClose);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = csaListingLabel(listing);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Attachments for ${label}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex min-w-0 items-center gap-2 font-display text-base font-semibold text-fg">
            <Paperclip className="h-4 w-4 shrink-0 text-accent" />
            <span className="truncate">{label}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <AttachmentsSection parent="csaListing" itemId={listing.id} readOnly={!canEdit} />
        </div>
      </div>
    </div>
  );
}
