import { Fragment, useEffect, useState } from "react";
import { ClipboardPaste, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { QUOTE_ALTERNATE_SOURCES, type QuoteAlternate, type QuoteAlternateSource } from "@/types/quote";
import { blankAlternate, parsePastedAlternates } from "@/lib/quoteMapper";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// The quote's ALTERNATES table (the 2026-10-27 review; Ray, 2026-10-29). Each
// row names the part (its designator, "5a") and holds up to three
// manufacturer options side by side — Manufacturer,
// Mfr part #, Lead time — then a free-text reason for choosing the alternate.
// It PRINTS, on a page of its own after the quote ("page two"), so the
// customer sees why a part was sourced the way it was instead of an ad-hoc
// screenshot.
//
// The card is read-only; Edit opens `AlternatesEditor`, which saves the whole
// table at once. Rows can be typed, or pasted straight from the working
// spreadsheet: copy the cells in Excel ([Designator |] Mfr 1 | Mfr part # 1 |
// Lead time 1 | ... | Lead time 3 | Reason), header row included or not, and
// paste - `parsePastedAlternates` splits on the tabs Excel puts on the
// clipboard and reads the header to tell whether a designator leads. Pasted rows are ADDED below what's
// there, never replacing it.
//
// A stored table ARC couldn't read (`corrupt`) is shown as an error and can't
// be edited — saving would overwrite whatever is really there.
// =============================================================================

const SOURCE_FIELDS: { key: keyof QuoteAlternateSource; label: string }[] = [
  { key: "manufacturer", label: "Manufacturer" },
  { key: "partNumber", label: "Mfr part #" },
  { key: "leadTime", label: "Lead time" },
];

const OPTIONS = Array.from({ length: QUOTE_ALTERNATE_SOURCES }, (_, i) => i);

interface QuoteAlternatesCardProps {
  rows: QuoteAlternate[];
  corrupt: boolean;
  canEdit: boolean;
  /** Open the editor (the page wraps it in its Sent guard). */
  onEdit: () => void;
}

export function QuoteAlternatesCard({ rows, corrupt, canEdit, onEdit }: QuoteAlternatesCardProps) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-label="Alternates">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Alternates</h2>
        {canEdit && !corrupt && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit alternates"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
      </div>
      <p className="mb-3 text-[11px] font-semibold text-fg-muted">
        Printed on its own page after the quote. Leave it empty for no alternates page.
      </p>
      {corrupt ? (
        <p role="alert" className="rounded-md border border-cooper-red/40 bg-cooper-red/5 px-3 py-2 text-sm text-fg">
          The stored alternates table couldn't be read, so it isn't shown and can't be edited here. Check the
          Alternates column on the Quotes list in SharePoint.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No alternates added.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th rowSpan={2} className="px-2 py-1.5 align-bottom font-semibold">
                  Designator
                </th>
                {OPTIONS.map((i) => (
                  <th key={i} colSpan={3} className="border-l border-border px-2 pt-1.5 font-semibold">
                    Option {i + 1}
                  </th>
                ))}
                <th rowSpan={2} className="border-l border-border px-2 py-1.5 align-bottom font-semibold">
                  Reason for the alternate
                </th>
              </tr>
              <tr>
                {OPTIONS.map((i) => (
                  <Fragment key={i}>
                    {SOURCE_FIELDS.map((f, n) => (
                      <th
                        key={f.key}
                        className={`whitespace-nowrap px-2 pb-1.5 font-semibold normal-case tracking-normal ${n === 0 ? "border-l border-border" : ""}`}
                      >
                        {f.label}
                      </th>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-fg">
                    {r.designator || <span className="font-normal text-fg-muted">—</span>}
                  </td>
                  {OPTIONS.map((i) => (
                    <Fragment key={i}>
                      {SOURCE_FIELDS.map((f, k) => (
                        <td
                          key={f.key}
                          className={`px-2 py-1.5 text-fg ${k === 0 ? "border-l border-border" : ""} ${f.key === "partNumber" ? "whitespace-nowrap font-medium" : f.key === "leadTime" ? "whitespace-nowrap" : ""}`}
                        >
                          {r.sources[i]?.[f.key] || <span className="text-fg-muted">—</span>}
                        </td>
                      ))}
                    </Fragment>
                  ))}
                  <td className="min-w-[14rem] border-l border-border px-2 py-1.5 text-fg-muted">{r.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface AlternatesEditorProps {
  rows: QuoteAlternate[];
  busy: boolean;
  onSave: (rows: QuoteAlternate[]) => Promise<void>;
  onClose: () => void;
}

function hasContent(r: QuoteAlternate): boolean {
  return !!r.designator.trim() || !!r.reason.trim() || r.sources.some((s) => s.manufacturer.trim() || s.partNumber.trim() || s.leadTime.trim());
}

function cloneRow(r: QuoteAlternate): QuoteAlternate {
  return { designator: r.designator, sources: r.sources.map((s) => ({ ...s })), reason: r.reason };
}

/** Edit the whole table; Save writes it in one go. */
export function AlternatesEditor({ rows: initial, busy, onSave, onClose }: AlternatesEditorProps) {
  const [rows, setRows] = useState<QuoteAlternate[]>(() =>
    initial.length > 0 ? initial.map(cloneRow) : [blankAlternate()],
  );
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  function setSource(row: number, option: number, key: keyof QuoteAlternateSource, value: string) {
    setRows((prev) =>
      prev.map((r, n) =>
        n === row ? { ...r, sources: r.sources.map((s, i) => (i === option ? { ...s, [key]: value } : s)) } : r,
      ),
    );
  }

  function setReason(row: number, value: string) {
    setRows((prev) => prev.map((r, n) => (n === row ? { ...r, reason: value } : r)));
  }

  function setDesignator(row: number, value: string) {
    setRows((prev) => prev.map((r, n) => (n === row ? { ...r, designator: value } : r)));
  }

  function addPasted() {
    const pasted = parsePastedAlternates(pasteText);
    if (pasted.length === 0) {
      setPasteNote("Nothing to add — copy the cells in Excel, then paste them here.");
      return;
    }
    // Added BELOW what's there; an empty starter row is replaced.
    setRows((prev) => [...prev.filter(hasContent), ...pasted]);
    setPasteText("");
    setPasting(false);
    setPasteNote(`Added ${pasted.length} ${pasted.length === 1 ? "row" : "rows"}.`);
  }

  async function save() {
    setError(null);
    try {
      await onSave(rows);
      onClose();
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit alternates"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-semibold text-fg">Alternates</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-[11px] font-semibold text-fg-muted">
            Printed on the customer's quote. Up to three manufacturer options per row, and why the alternate was
            chosen. Blank rows are dropped when you save.
          </p>

          <div className="mb-3">
            {pasting ? (
              <div className="rounded-lg border border-border p-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                    Paste from Excel
                  </span>
                  <AutoGrowTextarea
                    style={{ minHeight: "5rem" }}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={4}
                    placeholder={
                      "Copy the cells in Excel — Designator (optional), then Manufacturer | Mfr part # | Lead time three times across, then Reason — and paste them here. A header row is fine."
                    }
                    className="input resize-y font-mono text-xs"
                    aria-label="Paste from Excel"
                  />
                </label>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={addPasted}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
                  >
                    Add rows
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasting(false);
                      setPasteText("");
                    }}
                    className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPasting(true);
                  setPasteNote(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                Paste from Excel
              </button>
            )}
            {pasteNote && (
              <p role="status" className="mt-1 text-xs text-fg-muted">
                {pasteNote}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {rows.map((row, r) => (
              <div key={r} className="rounded-lg border border-border p-3" data-testid={`alternate-row-${r}`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                      Row {r + 1}
                    </span>
                    <input
                      aria-label={`Row ${r + 1} designator`}
                      placeholder="Designator"
                      value={row.designator}
                      onChange={(e) => setDesignator(r, e.target.value)}
                      className="input w-36!"
                      disabled={busy}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, n) => n !== r))}
                    aria-label={`Remove row ${r + 1}`}
                    className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-cooper-red"
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {OPTIONS.map((i) => (
                    <fieldset key={i} className="min-w-0 rounded-md bg-surface-2 p-2">
                      <legend className="px-1 text-[11px] font-semibold text-fg-muted">Option {i + 1}</legend>
                      <div className="flex flex-col gap-1.5">
                        {SOURCE_FIELDS.map((f) => (
                          <input
                            key={f.key}
                            aria-label={`Row ${r + 1} option ${i + 1} ${f.label}`}
                            placeholder={f.label}
                            value={row.sources[i]?.[f.key] ?? ""}
                            onChange={(e) => setSource(r, i, f.key, e.target.value)}
                            className="input"
                            disabled={busy}
                          />
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
                <AutoGrowTextarea
                  aria-label={`Row ${r + 1} reason for the alternate`}
                  placeholder="Reason for choosing the alternate"
                  value={row.reason}
                  onChange={(e) => setReason(r, e.target.value)}
                  rows={2}
                  className="input mt-2 resize-y"
                  disabled={busy}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, blankAlternate()])}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            disabled={busy}
          >
            <Plus className="h-3.5 w-3.5" />
            Add a row
          </button>

          {error && (
            <p role="alert" className="mt-4 text-sm text-cooper-red">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
