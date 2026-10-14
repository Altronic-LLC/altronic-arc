import { useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { NewProductWorksheet } from "@/types/pricing";
import { useSapComparison, type SapComparisonRow } from "@/hooks/usePricingLookup";
import { useUpdateNewProductWorksheet } from "@/hooks/useNewProductPricing";
import { useSortableTable } from "@/hooks/useSortableTable";
import { MAX_COMPARISON_PARTS, addComparisonParts, averageBaseGM, parsePartNumberList } from "@/lib/pricingMath";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import type { SortColumn } from "@/lib/tableSort";
import { SortableHeader } from "./SortableTableHeader";
import { PricingCard } from "./pricingAtoms";

// =============================================================================
// SAP comparison (Ray, 2026-10-14) — any number of existing SAP parts, with
// their list price, cost and base GM from the Fabric SAP warehouse, kept on
// the worksheet as a REFERENCE while a new product is priced.
//
// * The worksheet keeps the NUMBERS (`ComparisonParts`), never the figures:
//   they're re-read from SAP every time, so the reference can't go stale.
// * Not revisioned, and not part of the draft — adding or removing a part is
//   saved straight away. It describes the market, not the product.
// * Base GM is at the DISTRIBUTOR price, each part at its own MPG's discount
//   (else 34%) — the same way every comparable in Sales Pricing is measured.
// * Paste a column out of Excel: numbers split on lines, commas, spaces.
// =============================================================================

type Row = SapComparisonRow & { index: number };

const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2));

const COLUMNS: SortColumn<Row>[] = [
  // The Altronic # sits under the SAP # in this one column, so the table fits
  // beside the worksheet's sidebar without scrolling sideways.
  { key: "sap", label: "SAP / Altronic #", value: (r) => r.sapPartNumber },
  { key: "description", label: "Description", value: (r) => r.part?.description ?? "", noFilter: true },
  { key: "mpg", label: "MPG", value: (r) => r.part?.mpg ?? "" },
  { key: "list", label: "List", kind: "number", value: (r) => money(r.part?.listPrice), sortValue: (r) => r.part?.listPrice ?? null, noFilter: true },
  { key: "disc", label: "Disc.", kind: "number", value: (r) => (r.figures ? `${r.figures.distributorDiscountPct}%` : ""), sortValue: (r) => r.figures?.distributorDiscountPct ?? null },
  { key: "dist", label: "Dist. price", kind: "number", value: (r) => money(r.figures?.distributorPrice), sortValue: (r) => r.figures?.distributorPrice ?? null, noFilter: true },
  { key: "cost", label: "Cost", kind: "number", value: (r) => money(r.part?.cost), sortValue: (r) => r.part?.cost ?? null, noFilter: true },
  { key: "gm", label: "Base GM", kind: "number", value: (r) => (r.figures?.baseGM == null ? "" : `${r.figures.baseGM.toFixed(1)}%`), sortValue: (r) => r.figures?.baseGM ?? null, noFilter: true },
];

export function SapComparisonCard({ ws, readOnly }: { ws: NewProductWorksheet; readOnly: boolean }) {
  const update = useUpdateNewProductWorksheet();
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const parts = ws.comparisonParts;
  const { rows, notConnected, failed } = useSapComparison(parts);
  const indexed = useMemo<Row[]>(() => rows.map((r, index) => ({ ...r, index })), [rows]);
  const table = useSortableTable({ rows: indexed, columns: COLUMNS, stableKey: (r) => -r.index, initialKey: "sap" });
  const avg = averageBaseGM(rows.map((r) => r.figures?.baseGM ?? null));

  function save(next: string[]) {
    update.mutate({ id: ws.id, patch: { comparisonParts: next } });
  }

  function add() {
    const asked = parsePartNumberList(text);
    if (asked.length === 0) return;
    const { parts: next, skipped } = addComparisonParts(parts, asked);
    const added = next.length - parts.length;
    setNote(
      [
        added === 0 ? "Already on the list." : null,
        skipped > 0 ? `${skipped} not added — the list holds ${MAX_COMPARISON_PARTS} at most.` : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
    );
    if (added > 0) save(next);
    setText("");
  }

  return (
    <PricingCard title="SAP comparison" testId="sap-comparison">
      <p className="text-xs text-fg-muted">
        Existing SAP parts to price against — list, cost and base GM at the distributor price, read from SAP each time
        the page opens. The list is kept on this worksheet.
      </p>

      {!readOnly && (
        <form
          className="mt-3 flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <textarea
            aria-label="SAP part numbers to compare"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
            placeholder="SAP part numbers — paste several at once"
            className="input !h-9 min-h-9 !w-80 max-w-full resize-y py-1.5"
          />
          <button
            type="submit"
            disabled={!text.trim() || update.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
          >
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </button>
          {note && <p className="w-full text-xs text-fg-muted">{note}</p>}
        </form>
      )}

      {notConnected && parts.length > 0 && (
        <p className="mt-3 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-3 py-2 text-xs text-fg">
          SAP data isn't connected to ARC yet, so these parts have no figures. The list is kept, and they'll fill in once
          it is.
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-3 text-xs text-cooper-red">
          Some parts couldn't be read from SAP just now — refresh to try again.
        </p>
      )}

      {parts.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">No parts to compare yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                {COLUMNS.map((c) => (
                  <SortableHeader
                    key={c.key}
                    label={c.label}
                    className={c.kind === "number" ? "px-2 [&>div]:justify-end" : "px-2"}
                    {...table.headerProps(c.key)}
                  />
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.sapPartNumber} className="border-t border-border">
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">
                    {r.sapPartNumber}
                    {r.part?.altronicPartNumber && <span className="block text-[11px] text-fg-muted">{r.part.altronicPartNumber}</span>}
                  </td>
                  {r.loading ? (
                    <td colSpan={7} className="px-2 py-1.5 text-xs text-fg-muted">
                      <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Reading SAP…
                    </td>
                  ) : !r.part ? (
                    <td colSpan={7} className="px-2 py-1.5 text-xs text-fg-muted">
                      {notConnected ? "—" : "Not in SAP — check the number."}
                    </td>
                  ) : (
                    <>
                      <td className="min-w-[10rem] px-2 py-1.5 text-xs">{r.part.description || "—"}</td>
                      <td className="px-2 py-1.5">{r.part.mpg || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(r.part.listPrice)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums" title={r.figures?.discountFromSap ? "SAP's discount for the MPG" : "SAP has none for the MPG — the standard 34%"}>
                        {r.figures ? `${r.figures.distributorDiscountPct}%${r.figures.discountFromSap ? "" : "*"}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(r.figures?.distributorPrice ?? null)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(r.part.cost)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums">{formatPct(r.figures?.baseGM ?? null)}</td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-right">
                    {!readOnly && (
                      <button
                        type="button"
                        aria-label={`Remove ${r.sapPartNumber}`}
                        disabled={update.isPending}
                        onClick={() => save(parts.filter((p) => p !== r.sapPartNumber))}
                        className="rounded p-0.5 text-fg-muted hover:text-cooper-red"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-fg-muted">
            {avg.average === null
              ? "No base GM to average yet."
              : `Average base GM ${formatPct(avg.average)} over ${avg.counted} part${avg.counted === 1 ? "" : "s"} (a simple average).`}{" "}
            {rows.some((r) => r.figures && !r.figures.discountFromSap) && "* SAP has no discount for that MPG, so the standard 34% is used."}
          </p>
        </div>
      )}
    </PricingCard>
  );
}
