import { useEffect, useState } from "react";
import { ClipboardPaste, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { QuoteLeadTime } from "@/types/quote";
import { parsePastedLeadTimes } from "@/lib/quoteMapper";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// The quote's LEAD-TIME table (the 2026-10-27 review) — part, description,
// lead time, and the reason that part or alternate was chosen. It PRINTS, on
// a page of its own after the quote ("page two"), so the customer sees why a
// component was sourced the way it was instead of an ad-hoc screenshot.
//
// The card is read-only; Edit opens `LeadTimesEditor`, which saves the whole
// table at once. Rows can be typed, or pasted straight from the working
// spreadsheet: copy the cells in Excel (Part # | Description | Lead time |
// Reason) and paste — `parsePastedLeadTimes` splits on the tabs Excel puts
// on the clipboard. Pasted rows are ADDED below what's there, never replacing
// it.
//
// A stored table ARC couldn't read (`corrupt`) is shown as an error and can't
// be edited — saving would overwrite whatever is really there.
// =============================================================================

const BLANK: QuoteLeadTime = { partNumber: "", description: "", leadTime: "", reason: "" };

const COLUMNS: { key: keyof QuoteLeadTime; label: string }[] = [
  { key: "partNumber", label: "Part #" },
  { key: "description", label: "Description" },
  { key: "leadTime", label: "Lead time" },
  { key: "reason", label: "Reason for this part / alternate" },
];

interface QuoteLeadTimesCardProps {
  rows: QuoteLeadTime[];
  corrupt: boolean;
  canEdit: boolean;
  /** Open the editor (the page wraps it in its Sent guard). */
  onEdit: () => void;
}

export function QuoteLeadTimesCard({ rows, corrupt, canEdit, onEdit }: QuoteLeadTimesCardProps) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-label="Lead times">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Lead times</h2>
        {canEdit && !corrupt && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit lead times"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
      </div>
      <p className="mb-3 text-[11px] font-semibold text-fg-muted">
        Printed on its own page after the quote. Leave it empty for no lead-time page.
      </p>
      {corrupt ? (
        <p role="alert" className="rounded-md border border-cooper-red/40 bg-cooper-red/5 px-3 py-2 text-sm text-fg">
          The stored lead-time table couldn't be read, so it isn't shown and can't be edited here. Check the
          LeadTimes column on the Quotes list in SharePoint.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No lead times added.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 py-1.5 font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 font-medium text-fg">{r.partNumber || "—"}</td>
                  <td className="px-2 py-1.5 text-fg">{r.description || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-fg">{r.leadTime || "—"}</td>
                  <td className="px-2 py-1.5 text-fg-muted">{r.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface LeadTimesEditorProps {
  rows: QuoteLeadTime[];
  busy: boolean;
  onSave: (rows: QuoteLeadTime[]) => Promise<void>;
  onClose: () => void;
}

/** Edit the whole table; Save writes it in one go. */
export function LeadTimesEditor({ rows: initial, busy, onSave, onClose }: LeadTimesEditorProps) {
  const [rows, setRows] = useState<QuoteLeadTime[]>(() => (initial.length > 0 ? initial.map((r) => ({ ...r })) : [{ ...BLANK }]));
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

  function setCell(i: number, key: keyof QuoteLeadTime, value: string) {
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, [key]: value } : r)));
  }

  function addPasted() {
    const pasted = parsePastedLeadTimes(pasteText);
    if (pasted.length === 0) {
      setPasteNote("Nothing to add — copy the cells in Excel, then paste them here.");
      return;
    }
    // Added BELOW what's there; a single blank starter row is replaced.
    setRows((prev) => {
      const kept = prev.filter((r) => r.partNumber || r.description || r.leadTime || r.reason);
      return [...kept, ...pasted];
    });
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
        aria-label="Edit lead times"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-semibold text-fg">Lead times</h2>
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
            Printed on the customer's quote. Blank rows are dropped when you save.
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
                    placeholder={"Copy the cells in Excel — Part # | Description | Lead time | Reason — and paste them here."}
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
            {rows.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-1 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[8rem_minmax(0,1fr)_7rem_minmax(0,1.2fr)_auto] sm:items-start sm:border-0 sm:p-0"
              >
                {COLUMNS.map((c) =>
                  c.key === "reason" ? (
                    <AutoGrowTextarea
                      key={c.key}
                      aria-label={`Row ${i + 1} ${c.label}`}
                      placeholder={c.label}
                      value={row[c.key]}
                      onChange={(e) => setCell(i, c.key, e.target.value)}
                      rows={1}
                      className="input resize-y"
                      disabled={busy}
                    />
                  ) : (
                    <input
                      key={c.key}
                      aria-label={`Row ${i + 1} ${c.label}`}
                      placeholder={c.label}
                      value={row[c.key]}
                      onChange={(e) => setCell(i, c.key, e.target.value)}
                      className="input"
                      disabled={busy}
                    />
                  ),
                )}
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, n) => n !== i))}
                  aria-label={`Remove row ${i + 1}`}
                  className="justify-self-end rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-cooper-red"
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { ...BLANK }])}
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
