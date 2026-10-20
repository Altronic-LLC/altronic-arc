import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import type { MrbEntry } from "@/types/task";
import {
  MRB_RANGE_PRESETS,
  generateMrbPdf,
  generateMrbWorkbook,
  mrbCostTotal,
  mrbExportFileName,
  mrbPresetRange,
  mrbRangeProblem,
  selectMrbExport,
  type MrbExportFormat,
} from "@/lib/mrbExport";
import { formatMoney } from "@/lib/mrbMapper";
import { downloadBlob } from "@/hooks/useQuotePdf";
import { ChoicePills } from "./ChoicePills";
import { DateField } from "./DateField";
import { pushToast } from "./Toast";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Export the MRB register for a meeting — a date window, a format, and a
// button. The rules for WHICH entries go in live in lib/mrbExport.ts; this is
// only the controls, plus a live count so nobody prints an empty pack.
//
// Opens on the last 30 days, PDF, with every undecided entry included
// whatever its date — the board's backlog is the point of the meeting.
// =============================================================================

const FORMATS = [
  { value: "pdf", label: "PDF (to print)" },
  { value: "xlsx", label: "Excel" },
];

export function MrbExportModal({ entries, onClose }: { entries: MrbEntry[]; onClose: () => void }) {
  const initial = mrbPresetRange("30d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [includeAllOpen, setIncludeAllOpen] = useState(true);
  const [format, setFormat] = useState<MrbExportFormat>("pdf");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  const problem = mrbRangeProblem(from, to);
  const model = useMemo(
    () => selectMrbExport(entries, { from, to, includeAllOpen }),
    [entries, from, to, includeAllOpen],
  );
  const count = model.needs.length + model.decided.length;

  async function handleExport() {
    if (problem || count === 0) return;
    setBusy(true);
    try {
      // Stamp the time at the press, not when the dialog opened.
      const fresh = { ...model, generatedAt: new Date() };
      const blob = format === "pdf" ? await generateMrbPdf(fresh) : await generateMrbWorkbook(fresh);
      downloadBlob(blob, mrbExportFileName(fresh, format));
      onClose();
    } catch (err) {
      pushToast({
        message: `Couldn't build the export: ${err instanceof Error ? err.message : "unknown error"}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export for MRB meeting"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Download className="h-4 w-4 text-accent" />
            Export for MRB meeting
          </h2>
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

        <div className="flex flex-col gap-4 px-5 py-4">
          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              MRB dates
            </span>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {MRB_RANGE_PRESETS.map((preset) => {
                const range = mrbPresetRange(preset.id);
                const active = range.from === from && range.to === to;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setFrom(range.from);
                      setTo(range.to);
                    }}
                    disabled={busy}
                    className={
                      active
                        ? "rounded-md border border-accent bg-accent/10 px-2.5 py-1 text-xs font-medium text-fg"
                        : "rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-2"
                    }
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            {/* <div>s, not <label>s: a label round a calendar full of buttons
                re-clicks the trigger (see DateField). */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-xs text-fg-muted">From</span>
                <DateField value={from} onChange={setFrom} disabled={busy} placeholder="Any" aria-label="From" />
              </div>
              <div>
                <span className="mb-1 block text-xs text-fg-muted">To</span>
                <DateField value={to} onChange={setTo} disabled={busy} placeholder="Any" aria-label="To" />
              </div>
            </div>
            {problem && <p className="mt-1 text-xs text-cooper-red">{problem}</p>}
          </div>

          <label className="flex items-start gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={includeAllOpen}
              onChange={(e) => setIncludeAllOpen(e.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 accent-cooper-red"
            />
            <span>
              Include every entry still needing a disposition, whatever its date
              <span className="block text-xs text-fg-muted">
                Older undecided entries are what the meeting is for. Untick to keep
                to the dates above only.
              </span>
            </span>
          </label>

          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Format
            </span>
            <ChoicePills
              label="Format"
              name="mrb-export-format"
              options={FORMATS}
              value={format}
              onChange={(v) => setFormat(v as MrbExportFormat)}
              disabled={busy}
            />
          </div>

          <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg" role="status">
            {count === 0 ? (
              "Nothing to export for these dates."
            ) : (
              <>
                {model.needs.length} need a disposition · {model.decided.length} decided ·{" "}
                {formatMoney(mrbCostTotal([...model.needs, ...model.decided]))}
                <span className="block text-xs text-fg-muted">Archive entries are never included.</span>
              </>
            )}
          </p>
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
            onClick={handleExport}
            disabled={busy || !!problem || count === 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
