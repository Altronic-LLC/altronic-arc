import { useRef, useState } from "react";
import { RotateCcw, Trash2, Upload } from "lucide-react";
import type { SubAssembly, SubAssemblyLine } from "@/types/pricing";
import type { SubAssemblyDraft } from "@/api/newProductSubAssemblies";
import { importSubAssemblyCsv, mergeUpload, type UploadChanges } from "@/lib/subAssemblyCsv";
import { lineUnitCost, subAssemblyCost } from "@/lib/pricingMath";
import { formatMoney, formatUnitCost } from "@/lib/quoteMoney";
import { cn } from "@/lib/cn";

// =============================================================================
// One sub-assembly on a New Product Pricing worksheet (Ray, 2026-10-13):
//   * Upload CSV — Part Number, Description, Current Cost, Qty. A re-upload
//     REPLACES the lines but keeps each part's adjustment, and says what
//     changed.
//   * Each line shows the UPLOADED cost (the sheet's, never edited) beside an
//     ADJUSTED cost the manager may type; the cost used is adjusted ?? uploaded.
//     Clearing an adjustment goes back to the uploaded cost.
//   * Totals per one sub-assembly, at uploaded and at used cost.
// Edits change the DRAFT only; the worksheet's Save writes them.
// =============================================================================

export function draftAsSubAssembly(d: SubAssemblyDraft): SubAssembly {
  return {
    id: d.id ?? 0,
    worksheetId: 0,
    rev: 0,
    name: d.name || "Sub-assembly",
    sortOrder: 0,
    quantityPerProduct: d.quantityPerProduct,
    lines: d.lines,
    linesCorrupt: false,
    fileName: d.fileName,
    uploadedAt: d.uploadedAt,
    uploadedBy: d.uploadedBy,
  };
}

export function SubAssemblyCard({
  draft,
  onChange,
  onRemove,
  readOnly,
  uploader,
}: {
  draft: SubAssemblyDraft;
  onChange: (next: SubAssemblyDraft) => void;
  onRemove: () => void;
  readOnly: boolean;
  uploader: { displayName: string; email: string };
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<{ errors: string[]; skipped: string[]; changes: UploadChanges | null } | null>(null);
  const cost = subAssemblyCost(draftAsSubAssembly(draft));

  async function onFile(file: File) {
    const text = await file.text();
    const result = importSubAssemblyCsv(text);
    if (result.errors.length > 0) {
      setReport({ errors: result.errors, skipped: [], changes: null });
      return;
    }
    const first = draft.lines.length === 0;
    const { lines, changes } = mergeUpload(draft.lines, result.lines);
    onChange({
      ...draft,
      name: draft.name || file.name.replace(/\.csv$/i, ""),
      lines,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      uploadedBy: uploader,
    });
    setReport({ errors: [], skipped: result.skipped, changes: first ? null : changes });
  }

  function setLine(i: number, patch: Partial<SubAssemblyLine>) {
    onChange({ ...draft, lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label={`Sub-assembly ${draft.name || "(unnamed)"}`}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Sub-assembly</span>
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            disabled={readOnly}
            className="input font-medium"
            placeholder="Name"
          />
        </label>
        <label className="flex w-32 flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Qty per product</span>
          <input
            type="number"
            min={0}
            step="any"
            value={draft.quantityPerProduct}
            onChange={(e) => onChange({ ...draft, quantityPerProduct: Number(e.target.value) })}
            disabled={readOnly}
            className="input tabular-nums"
          />
        </label>
        {!readOnly && (
          <div className="flex gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label={`Upload CSV for ${draft.name || "sub-assembly"}`}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              <Upload className="h-4 w-4" /> {draft.lines.length ? "Re-upload CSV" : "Upload CSV"}
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${draft.name || "sub-assembly"}`}
              className="inline-flex items-center rounded-md border border-border bg-surface px-2 py-1.5 text-fg-muted hover:border-cooper-red hover:text-cooper-red"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {draft.fileName && (
        <p className="mt-2 text-[11px] text-fg-muted">
          {draft.fileName}
          {draft.uploadedAt && ` · uploaded ${new Date(draft.uploadedAt).toLocaleString()}`}
          {draft.uploadedBy && ` by ${draft.uploadedBy.displayName}`}
        </p>
      )}

      {report && (
        <div
          role={report.errors.length ? "alert" : "status"}
          className={cn(
            "mt-2 rounded-md border px-3 py-2 text-xs",
            report.errors.length ? "border-cooper-red/40 bg-cooper-red/10 text-cooper-red" : "border-border bg-surface-2/50 text-fg",
          )}
        >
          {report.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
          {report.changes && (
            <p>
              Replaced from the new file: {report.changes.added.length} added, {report.changes.removed.length} removed,{" "}
              {report.changes.costChanged.length} uploaded cost{report.changes.costChanged.length === 1 ? "" : "s"} changed
              {report.changes.keptAdjustments > 0 && `, ${report.changes.keptAdjustments} adjustment(s) kept`}.
            </p>
          )}
          {report.skipped.length > 0 && (
            <details className="mt-1">
              <summary>{report.skipped.length} row(s) left out</summary>
              <ul className="mt-1 list-disc pl-5">
                {report.skipped.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
          )}
          {!report.errors.length && (
            <button type="button" onClick={() => setReport(null)} className="mt-1 text-accent hover:underline">
              Dismiss
            </button>
          )}
        </div>
      )}

      {draft.lines.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          No lines yet. Upload a CSV with Part Number, Description, Current Cost and Qty columns.
        </p>
      ) : (
        <div className="scroll-elegant mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-2 py-1.5 font-semibold">Part</th>
                <th className="px-2 py-1.5 font-semibold">Description</th>
                <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                <th className="px-2 py-1.5 text-right font-semibold">Uploaded cost</th>
                <th className="px-2 py-1.5 text-right font-semibold">Adjusted cost</th>
                <th className="px-2 py-1.5 text-right font-semibold">Extended</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line, i) => {
                const used = lineUnitCost(line);
                const adjusted = line.adjustedCost !== null;
                return (
                  <tr key={`${line.partNumber}-${i}`} className="border-t border-border">
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{line.partNumber}</td>
                    <td className="px-2 py-1.5">{line.description}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{line.quantity}</td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", adjusted && "text-fg-muted line-through")}>
                      {line.uploadedCost === null ? <span className="text-cooper-red no-underline">none</span> : formatUnitCost(line.uploadedCost)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {readOnly ? (
                        <span className="tabular-nums">{adjusted ? formatUnitCost(line.adjustedCost) : "—"}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            aria-label={`Adjusted cost for ${line.partNumber}`}
                            value={line.adjustedCost ?? ""}
                            placeholder="—"
                            onChange={(e) =>
                              setLine(i, { adjustedCost: e.target.value === "" ? null : Number(e.target.value) })
                            }
                            className={cn("input w-24 text-right tabular-nums", adjusted && "border-ajax-yellow")}
                          />
                          {adjusted && (
                            <button
                              type="button"
                              onClick={() => setLine(i, { adjustedCost: null })}
                              aria-label={`Use the uploaded cost for ${line.partNumber}`}
                              title="Go back to the uploaded cost"
                              className="rounded p-0.5 text-fg-muted hover:text-fg"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                      {used === null ? "—" : formatMoney(used * line.quantity)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-medium">
                <td className="px-2 py-1.5" colSpan={3}>
                  Per one sub-assembly
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums" title="At the uploaded costs">
                  {formatMoney(cost.uploaded)}
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] font-normal text-fg-muted">used →</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(cost.used)}</td>
              </tr>
            </tfoot>
          </table>
          {cost.problems.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-cooper-red">
              {cost.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
