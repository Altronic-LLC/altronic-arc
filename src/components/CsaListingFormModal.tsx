import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { useCreateCsaListing, useUpdateCsaListing } from "@/hooks/useCsaListings";
import type { CsaListing, CsaListingInput } from "@/types/task";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { AttachmentsSection } from "./AttachmentsSection";
import { DATE_INPUT_MIN, DATE_INPUT_MAX } from "@/lib/dateInput";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface CsaListingFormModalProps {
  /** Omit to create; pass a listing to edit it. */
  listing?: CsaListing;
  onClose: () => void;
}

/**
 * Create/edit form for a CSA listing.
 *
 * Attachments (the certificate PDFs) only appear when EDITING: they attach to a
 * SharePoint list item, which doesn't exist until the listing is saved. Rather
 * than juggle a pending-upload queue for a rarely-created record, the create
 * form says where they'll be — save first, then attach.
 */
export function CsaListingFormModal({ listing, onClose }: CsaListingFormModalProps) {
  const isEdit = listing != null;
  const createListing = useCreateCsaListing();
  const updateListing = useUpdateCsaListing();

  const [fileNumber, setFileNumber] = useState(listing?.fileNumber ?? "");
  const [product, setProduct] = useState(listing?.product ?? "");
  const [alsoCover, setAlsoCover] = useState(listing?.alsoCover ?? "");
  const [partNoIncluded, setPartNoIncluded] = useState(listing?.partNoIncluded ?? "");
  const [history, setHistory] = useState(listing?.history ?? "");
  const [dateCertified, setDateCertified] = useState(() =>
    toDateInputValue(listing?.dateCertified ?? null),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fileNumber.trim()) {
      setError("A file number is required — it's how a listing is identified.");
      return;
    }
    setError(null);
    setBusy(true);

    const input: CsaListingInput = {
      fileNumber,
      product,
      alsoCover,
      partNoIncluded,
      history,
      dateCertified: fromDateInputValue(dateCertified),
    };

    try {
      if (isEdit) await updateListing.mutateAsync({ id: listing.id, input });
      else await createListing.mutateAsync(input);
      onClose();
    } catch {
      // The hook already surfaced the reason as an error toast; keep the form
      // open with its values so nothing typed is lost.
      setError("Couldn't save to SharePoint — your changes are still here, try again.");
      setBusy(false);
    }
  }

  // Dismiss on a genuine backdrop click only — never when a text-selection
  // drag merely happens to end out here (see useOverlayDismiss).
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            {isEdit ? (
              <>
                <Pencil className="h-4 w-4 text-accent" /> Edit CSA listing
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 text-accent" /> New CSA listing
              </>
            )}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="File Number *">
              {/* No `required` attribute on purpose: it makes the browser block
                  submit with a generic "Please fill out this field", which
                  pre-empts the message below explaining WHY a file number
                  matters. One clear explanation beats two overlapping ones. */}
              <input
                ref={firstFieldRef}
                type="text"
                value={fileNumber}
                onChange={(e) => setFileNumber(e.target.value)}
                placeholder="e.g. LR 41862-3"
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Date Certified">
              <input
                type="date"
                value={dateCertified}
                min={DATE_INPUT_MIN}
                max={DATE_INPUT_MAX}
                onChange={(e) => setDateCertified(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Product">
            <input
              type="text"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="e.g. DSG-1201 Ignition System"
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          <FieldLabel label="Also Cover">
            <textarea
              value={alsoCover}
              onChange={(e) => setAlsoCover(e.target.value)}
              rows={3}
              placeholder="Other products or variants this file covers — one per line"
              className={TEXTAREA_CLASS}
              disabled={busy}
            />
          </FieldLabel>

          <FieldLabel label="Part No Included">
            <textarea
              value={partNoIncluded}
              onChange={(e) => setPartNoIncluded(e.target.value)}
              rows={3}
              placeholder="Part numbers covered — one per line"
              className={TEXTAREA_CLASS}
              disabled={busy}
            />
          </FieldLabel>

          <FieldLabel label="History">
            <textarea
              value={history}
              onChange={(e) => setHistory(e.target.value)}
              rows={4}
              placeholder="Amendments, audits, anything worth knowing later…"
              className={TEXTAREA_CLASS}
              disabled={busy}
            />
          </FieldLabel>

          {error && (
            <div className="rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : isEdit ? "Save changes" : "Add listing"}
            </button>
          </div>
        </form>

        {/* Certificates and supporting documents. Only once the item exists —
            there's nothing to attach a file to before then. */}
        <div className="mt-5 border-t border-border pt-4">
          {isEdit ? (
            <AttachmentsSection parent="csaListing" itemId={listing.id} />
          ) : (
            <p className="text-xs text-fg-muted">
              Save the listing first, then reopen it to attach the certificate and any supporting
              documents.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const TEXTAREA_CLASS =
  "rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
