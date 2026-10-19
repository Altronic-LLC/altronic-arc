import { useEffect, useRef, useState } from "react";
import { Paperclip, Plus, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import type { SubAssembly, SubAssemblyLine } from "@/types/pricing";
import type { SubAssemblyDraft } from "@/api/newProductSubAssemblies";
import { SAP_PART_LOOKUP_CONNECTED } from "@/api/pricingLookup";
import { useSapPart } from "@/hooks/usePricingLookup";
import { importSubAssemblyCsv, lineLabel, mergeUpload, type UploadChanges } from "@/lib/subAssemblyCsv";
import { lineUnitCost, overheadFactor, subAssemblyCost } from "@/lib/pricingMath";
import { formatMoney, formatUnitCost } from "@/lib/quoteMoney";
import { AttachmentsSection } from "./AttachmentsSection";
import { RowSellingPrice } from "./RowSellingPrice";
import { cn } from "@/lib/cn";

// =============================================================================
// The rows of a New Product Pricing worksheet (Ray, 2026-10-13):
//
// A SUB-ASSEMBLY (`SubAssemblyCard`) has its own Altronic # and SAP #, and
// components that come from a CSV, are added by hand, or both:
//   * Upload CSV — Part Number and/or SAP Part Number, Description, Current
//     Cost, Qty. A re-upload REPLACES the CSV lines, keeps each part's
//     adjustment, and keeps every line added by hand; it says what changed.
//   * Add component — Altronic #, SAP #, description, quantity and cost.
// Every component's numbers, description and quantity can be edited, and any
// line removed.
//
// A standalone PART (`PartCard`) is one part on the product, not a
// sub-assembly: looked up in SAP (its cost comes in as the base cost) or typed
// by hand. It is held as a row with exactly one line, so the cost roll-up and
// revisions treat it like any sub-assembly.
//
// COST: each line has a BASE cost — the sheet's for a CSV line and SAP's for a
// SAP part (never edited here: change it with Adjusted cost, so "base vs
// adjusted" keeps its meaning), or what was typed for a hand-added line
// (editable). The ADJUSTED cost overrides it; the cost used is adjusted ?? base.
//
// FILES hang off each row (`npSubAssembly` attachments), so a row must be
// SAVED before it can take one; a new revision copies them across.
//
// Edits change the DRAFT only; the worksheet's Save writes them.
// =============================================================================

export function draftAsSubAssembly(d: SubAssemblyDraft): SubAssembly {
  return {
    id: d.id ?? 0,
    worksheetId: 0,
    rev: 0,
    name: d.name || (d.kind === "part" ? "Part" : "Sub-assembly"),
    kind: d.kind,
    altronicPartNumber: d.altronicPartNumber,
    sapPartNumber: d.sapPartNumber,
    sortOrder: 0,
    quantityPerProduct: d.quantityPerProduct,
    overheadPct: d.overheadPct,
    pricing: d.pricing,
    pricingCorrupt: d.pricingCorrupt,
    lines: d.lines,
    linesCorrupt: false,
    fileName: d.fileName,
    uploadedAt: d.uploadedAt,
    uploadedBy: d.uploadedBy,
  };
}

const num = (raw: string): number | null => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const SOURCE_CHIP: Record<NonNullable<SubAssemblyLine["source"]>, { label: string; tone: string }> = {
  csv: { label: "CSV", tone: "bg-surface-2 text-fg-muted" },
  manual: { label: "Manual", tone: "bg-superior-blue/10 text-superior-blue" },
  sap: { label: "SAP", tone: "bg-cooper-green/10 text-cooper-green" },
};

function SourceChip({ source }: { source: SubAssemblyLine["source"] }) {
  const chip = SOURCE_CHIP[source ?? "csv"];
  return <span className={cn("mt-0.5 block w-fit rounded px-1 text-[10px] font-semibold uppercase", chip.tone)}>{chip.label}</span>;
}

/** A row's files — once it is saved. An unsaved row has nowhere to hang them yet. */
function RowFiles({ draft, readOnly, name }: { draft: SubAssemblyDraft; readOnly: boolean; name: string }) {
  if (draft.id === null) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-fg-muted">
        <Paperclip className="h-3 w-3" /> Save the worksheet to attach files to {name}.
      </p>
    );
  }
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-fg-muted hover:text-fg">
        <Paperclip className="mr-1 inline h-3 w-3" />
        Files for {name}
      </summary>
      <div className="mt-2">
        <AttachmentsSection parent="npSubAssembly" itemId={draft.id} readOnly={readOnly} />
      </div>
    </details>
  );
}

function NumberInputs({
  draft,
  onChange,
  readOnly,
}: {
  draft: SubAssemblyDraft;
  onChange: (next: SubAssemblyDraft) => void;
  readOnly: boolean;
}) {
  return (
    <>
      <label className="flex w-36 flex-col gap-1 text-xs">
        <span className="font-semibold uppercase tracking-wider text-fg-muted">Altronic #</span>
        <input
          value={draft.altronicPartNumber}
          onChange={(e) => onChange({ ...draft, altronicPartNumber: e.target.value })}
          disabled={readOnly}
          className="input font-mono text-xs"
          aria-label={`Altronic part number of ${draft.name || "this row"}`}
        />
      </label>
      <label className="flex w-36 flex-col gap-1 text-xs">
        <span className="font-semibold uppercase tracking-wider text-fg-muted">SAP #</span>
        <input
          value={draft.sapPartNumber}
          onChange={(e) => onChange({ ...draft, sapPartNumber: e.target.value })}
          disabled={readOnly}
          className="input font-mono text-xs"
          aria-label={`SAP part number of ${draft.name || "this row"}`}
        />
      </label>
    </>
  );
}

export function SubAssemblyCard({
  draft,
  onChange,
  onRemove,
  readOnly,
  uploader,
  worksheetDiscountPct,
}: {
  draft: SubAssemblyDraft;
  onChange: (next: SubAssemblyDraft) => void;
  onRemove: () => void;
  readOnly: boolean;
  uploader: { displayName: string; email: string };
  /** The worksheet's distributor discount — a row's own price uses it unless it overrides. */
  worksheetDiscountPct: number;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<{ errors: string[]; skipped: string[]; changes: UploadChanges | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const cost = subAssemblyCost(draftAsSubAssembly(draft));
  const name = draft.name || "sub-assembly";

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
        <NumberInputs draft={draft} onChange={onChange} readOnly={readOnly} />
        <label className="flex w-24 flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Qty / product</span>
          <input
            type="number"
            min={0}
            step="any"
            value={draft.quantityPerProduct}
            onChange={(e) => onChange({ ...draft, quantityPerProduct: Number(e.target.value) })}
            disabled={readOnly}
            className="input tabular-nums"
            aria-label={`Quantity per product of ${name}`}
          />
        </label>
        <OverheadInput value={draft.overheadPct} readOnly={readOnly} label={name} onChange={(v) => onChange({ ...draft, overheadPct: v })} />
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label={`Upload CSV for ${name}`}
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
              <Upload className="h-4 w-4" /> {draft.fileName ? "Re-upload CSV" : "Upload CSV"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" /> Add component
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${name}`}
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
              {report.changes.keptAdjustments > 0 && `, ${report.changes.keptAdjustments} adjustment(s) kept`}
              {report.changes.keptManual > 0 && `, ${report.changes.keptManual} component(s) added by hand kept`}.
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

      {draft.lines.length === 0 && !adding ? (
        <p className="mt-3 text-sm text-fg-muted">
          No components yet. Upload a CSV with Part Number (and/or SAP Part Number), Description, Current Cost and Qty
          columns, or add components by hand.
        </p>
      ) : (
        <div className="scroll-elegant mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] table-fixed text-left text-sm">
            {/* Fixed widths for the numbers, so the description takes the spare room. */}
            <colgroup>
              <col className="w-[8.5rem]" />
              <col className="w-[8.5rem]" />
              <col />
              <col className="w-[4.5rem]" />
              <col className="w-[5.5rem]" />
              <col className="w-[6.5rem]" />
              <col className="w-[6.5rem]" />
              <col className="w-8" />
            </colgroup>
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-2 py-1.5 font-semibold">Altronic #</th>
                <th className="px-2 py-1.5 font-semibold">SAP #</th>
                <th className="px-2 py-1.5 font-semibold">Description</th>
                <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                <th
                  className="px-2 py-1.5 text-right font-semibold"
                  title="From the CSV (not editable — use Adjusted cost), or typed when the component was added by hand"
                >
                  Base cost
                </th>
                <th className="px-2 py-1.5 text-right font-semibold">Adjusted</th>
                <th className="px-2 py-1.5 text-right font-semibold">Extended</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line, i) => {
                const used = lineUnitCost(line);
                const adjusted = line.adjustedCost !== null;
                const manual = line.source === "manual";
                const label = lineLabel(line) || `line ${i + 1}`;
                return (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-2 py-1.5">
                      {readOnly ? (
                        <span className="font-mono text-xs">{line.partNumber}</span>
                      ) : (
                        <input
                          aria-label={`Altronic part number, line ${i + 1}`}
                          value={line.partNumber}
                          onChange={(e) => setLine(i, { partNumber: e.target.value })}
                          className="input !w-28 font-mono text-xs"
                        />
                      )}
                      <SourceChip source={line.source} />
                    </td>
                    <td className="px-2 py-1.5">
                      {readOnly ? (
                        <span className="font-mono text-xs">{line.sapPartNumber}</span>
                      ) : (
                        <input
                          aria-label={`SAP part number, line ${i + 1}`}
                          value={line.sapPartNumber ?? ""}
                          onChange={(e) => setLine(i, { sapPartNumber: e.target.value })}
                          className="input !w-28 font-mono text-xs"
                        />
                      )}
                    </td>
                    <td className="break-words px-2 py-1.5">
                      {readOnly ? (
                        line.description
                      ) : (
                        <input
                          aria-label={`Description, line ${i + 1}`}
                          value={line.description}
                          onChange={(e) => setLine(i, { description: e.target.value })}
                          className="input !w-full"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {readOnly ? (
                        <span className="tabular-nums">{line.quantity}</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step="any"
                          aria-label={`Quantity for ${label}`}
                          value={line.quantity}
                          onChange={(e) => setLine(i, { quantity: num(e.target.value) ?? 0 })}
                          className="input !w-full !px-1.5 text-right tabular-nums"
                        />
                      )}
                    </td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", adjusted && "text-fg-muted line-through")}>
                      {manual && !readOnly ? (
                        <input
                          type="number"
                          min={0}
                          step="any"
                          aria-label={`Base cost for ${label}`}
                          value={line.uploadedCost ?? ""}
                          placeholder="—"
                          onChange={(e) => setLine(i, { uploadedCost: num(e.target.value) })}
                          className="input !w-full !px-1.5 text-right tabular-nums"
                        />
                      ) : line.uploadedCost === null ? (
                        <span className="text-cooper-red no-underline">none</span>
                      ) : (
                        formatUnitCost(line.uploadedCost)
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <AdjustedCost line={line} label={label} readOnly={readOnly} onChange={(v) => setLine(i, { adjustedCost: v })} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                      {used === null ? "—" : formatMoney(used * line.quantity)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => onChange({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}
                          aria-label={`Remove ${label}`}
                          className="rounded p-1 text-fg-muted hover:text-cooper-red"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {adding && (
                <AddComponentRow
                  onAdd={(line) => {
                    onChange({ ...draft, lines: [...draft.lines, line] });
                    setAdding(false);
                  }}
                  onCancel={() => setAdding(false)}
                />
              )}
            </tbody>
            {draft.lines.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-medium">
                  <td className="px-2 py-1.5" colSpan={4}>
                    Per one sub-assembly
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" title="At the base costs">
                    {formatMoney(cost.uploaded)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-[11px] font-normal text-fg-muted">used →</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(cost.used)}</td>
                  <td />
                </tr>
                {overheadFactor(draft.overheadPct) !== 1 && (
                  <tr className="font-medium">
                    <td className="px-2 py-1.5 text-fg-muted" colSpan={6}>
                      With {draft.overheadPct}% overhead
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {cost.used === null ? "—" : formatMoney(cost.used * overheadFactor(draft.overheadPct))}
                    </td>
                    <td />
                  </tr>
                )}
              </tfoot>
            )}
          </table>
          {cost.problems.length > 0 && draft.lines.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-cooper-red">
              {cost.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <RowSellingPrice draft={draft} onChange={onChange} readOnly={readOnly} worksheetDiscountPct={worksheetDiscountPct} label={draft.name || "this sub-assembly"} />
      <RowFiles draft={draft} readOnly={readOnly} name={name} />
    </section>
  );
}

function AdjustedCost({
  line,
  label,
  readOnly,
  onChange,
}: {
  line: SubAssemblyLine;
  label: string;
  readOnly: boolean;
  onChange: (v: number | null) => void;
}) {
  const adjusted = line.adjustedCost !== null;
  if (readOnly) return <span className="tabular-nums">{adjusted ? formatUnitCost(line.adjustedCost) : "—"}</span>;
  return (
    <span className="inline-flex items-center justify-end gap-0.5">
      <input
        type="number"
        min={0}
        step="any"
        aria-label={`Adjusted cost for ${label}`}
        value={line.adjustedCost ?? ""}
        placeholder="—"
        onChange={(e) => onChange(num(e.target.value))}
        className={cn("input !w-[4.5rem] !px-1.5 text-right tabular-nums", adjusted && "border-ajax-yellow")}
      />
      {adjusted && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Use the base cost for ${label}`}
          title="Go back to the base cost"
          className="rounded p-0.5 text-fg-muted hover:text-fg"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

/** A blank row to type a component in by hand. One part number and a quantity above 0 are required. */
function AddComponentRow({ onAdd, onCancel }: { onAdd: (line: SubAssemblyLine) => void; onCancel: () => void }) {
  const [partNumber, setPartNumber] = useState("");
  const [sapPartNumber, setSapPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const quantity = num(qty);
  const costNum = num(cost);
  const ok =
    !!(partNumber.trim() || sapPartNumber.trim()) &&
    quantity !== null &&
    quantity > 0 &&
    (cost.trim() === "" || (costNum !== null && costNum >= 0));

  function add() {
    if (!ok) return;
    onAdd({
      partNumber: partNumber.trim(),
      sapPartNumber: sapPartNumber.trim(),
      description: description.trim(),
      quantity: quantity!,
      uploadedCost: costNum,
      adjustedCost: null,
      source: "manual",
    });
  }

  return (
    <tr className="border-t border-border bg-surface-2/40 align-top" aria-label="New component">
      <td className="px-2 py-1.5">
        <input
          aria-label="New component Altronic part number"
          value={partNumber}
          onChange={(e) => setPartNumber(e.target.value)}
          className="input !w-28 font-mono text-xs"
          autoFocus
          placeholder="Altronic #"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          aria-label="New component SAP part number"
          value={sapPartNumber}
          onChange={(e) => setSapPartNumber(e.target.value)}
          className="input !w-28 font-mono text-xs"
          placeholder="SAP #"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          aria-label="New component description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input !w-full"
          placeholder="Description"
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          type="number"
          min={0}
          step="any"
          aria-label="New component quantity"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="input !w-full !px-1.5 text-right tabular-nums"
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          type="number"
          min={0}
          step="any"
          aria-label="New component cost"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="input !w-full !px-1.5 text-right tabular-nums"
          placeholder="Cost"
        />
      </td>
      <td className="px-2 py-1.5 text-right" colSpan={3}>
        <span className="inline-flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-xs text-fg-muted hover:text-fg">
            Cancel
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!ok}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            Add
          </button>
        </span>
      </td>
    </tr>
  );
}

/**
 * A standalone part on the product (Ray, 2026-10-13) — from SAP, or typed by
 * hand with a typed cost. Look it up by either number: SAP fills in the
 * other number, the description and the cost (as the base cost, marked SAP).
 */
export function PartCard({
  draft,
  onChange,
  onRemove,
  readOnly,
  worksheetDiscountPct,
}: {
  draft: SubAssemblyDraft;
  onChange: (next: SubAssemblyDraft) => void;
  onRemove: () => void;
  readOnly: boolean;
  worksheetDiscountPct: number;
}) {
  const line: SubAssemblyLine = draft.lines[0] ?? {
    partNumber: "",
    sapPartNumber: "",
    description: "",
    quantity: 1,
    uploadedCost: null,
    adjustedCost: null,
    source: "manual",
  };
  const [lookup, setLookup] = useState({ altronicPartNumber: "", sapPartNumber: "" });
  const sap = useSapPart(lookup, !readOnly);
  const label = draft.altronicPartNumber || draft.sapPartNumber || draft.name || "this part";
  const used = lineUnitCost(line);

  function set(patch: Partial<SubAssemblyDraft>, linePatch: Partial<SubAssemblyLine> = {}) {
    const next = { ...draft, ...patch };
    const nextLine: SubAssemblyLine = {
      ...line,
      ...linePatch,
      partNumber: next.altronicPartNumber,
      sapPartNumber: next.sapPartNumber,
      description: next.name,
      quantity: 1,
    };
    onChange({ ...next, lines: [nextLine] });
  }

  // A part SAP holds: its numbers, description and cost come in, marked SAP.
  useEffect(() => {
    const p = sap.data;
    if (!p) return;
    set(
      { altronicPartNumber: p.altronicPartNumber, sapPartNumber: p.sapPartNumber, name: p.description },
      { uploadedCost: p.cost, source: "sap" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sap.data]);

  const fromSap = line.source === "sap";

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label={`Part ${label}`}>
      <div className="flex flex-wrap items-end gap-3">
        <span className="mb-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fg-muted">Part</span>
        <NumberInputs draft={draft} onChange={(d) => set({ altronicPartNumber: d.altronicPartNumber, sapPartNumber: d.sapPartNumber })} readOnly={readOnly} />
        {/* Live from SAP's cost view (Ray, 2026-10-17) — a part only needs its cost. */}
        {!readOnly && SAP_PART_LOOKUP_CONNECTED && (
          <button
            type="button"
            onClick={() => setLookup({ altronicPartNumber: draft.altronicPartNumber.trim(), sapPartNumber: draft.sapPartNumber.trim() })}
            disabled={!draft.altronicPartNumber.trim() && !draft.sapPartNumber.trim()}
            className="mb-0.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
          >
            <Search className="h-4 w-4" /> Look up in SAP
          </button>
        )}
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Description</span>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} disabled={readOnly} className="input" aria-label={`Description of ${label}`} />
        </label>
        <label className="flex w-24 flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Qty / product</span>
          <input
            type="number"
            min={0}
            step="any"
            value={draft.quantityPerProduct}
            onChange={(e) => set({ quantityPerProduct: Number(e.target.value) })}
            disabled={readOnly}
            className="input tabular-nums"
            aria-label={`Quantity per product of ${label}`}
          />
        </label>
        <OverheadInput value={draft.overheadPct} readOnly={readOnly} label={label} onChange={(v) => set({ overheadPct: v })} />
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className="mb-0.5 inline-flex items-center rounded-md border border-border bg-surface px-2 py-1.5 text-fg-muted hover:border-cooper-red hover:text-cooper-red"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {lookup.altronicPartNumber || lookup.sapPartNumber ? (
        sap.isFetching ? (
          <p className="mt-2 text-[11px] text-fg-muted">Looking it up in SAP…</p>
        ) : sap.data === null ? (
          <p className="mt-2 text-[11px] text-cooper-red">SAP doesn't have that part — type its cost in by hand.</p>
        ) : null
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-4 text-sm">
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Base cost</span>
          {fromSap || readOnly ? (
            <span className="text-sm tabular-nums text-fg">{line.uploadedCost === null ? "—" : formatUnitCost(line.uploadedCost)}</span>
          ) : (
            <input
              type="number"
              min={0}
              step="any"
              aria-label={`Base cost for ${label}`}
              value={line.uploadedCost ?? ""}
              onChange={(e) => set({}, { uploadedCost: num(e.target.value), source: "manual" })}
              className="input !w-28 text-right tabular-nums"
            />
          )}
          <SourceChip source={line.source} />
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Adjusted cost</span>
          <AdjustedCost line={line} label={label} readOnly={readOnly} onChange={(v) => set({}, { adjustedCost: v })} />
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Extended</span>
          <span className="text-sm tabular-nums text-fg">{used === null ? "—" : formatMoney(used * draft.quantityPerProduct * overheadFactor(draft.overheadPct))}</span>
        </div>
      </div>

      <RowSellingPrice draft={draft} onChange={onChange} readOnly={readOnly} worksheetDiscountPct={worksheetDiscountPct} label={label} />
      <RowFiles draft={draft} readOnly={readOnly} name={label} />
    </section>
  );
}

/** A row's optional overhead % — blank means none (Ray, 2026-10-13). */
function OverheadInput({
  value,
  readOnly,
  label,
  onChange,
}: {
  value: number | null;
  readOnly: boolean;
  label: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">Overhead %</span>
      <input
        type="number"
        min={0}
        step="any"
        value={value ?? ""}
        placeholder="None"
        onChange={(e) => onChange(num(e.target.value))}
        disabled={readOnly}
        className="input !w-24 tabular-nums"
        aria-label={`Overhead % on ${label}`}
      />
    </label>
  );
}