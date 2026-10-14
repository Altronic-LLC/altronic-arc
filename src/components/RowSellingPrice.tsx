import { useState } from "react";
import { Plus, Tag, X } from "lucide-react";
import type { PriceBreakTier, PriceInput, RowPricing } from "@/types/pricing";
import type { SubAssemblyDraft } from "@/api/newProductSubAssemblies";
import { MAX_PRICE_BREAKS, priceBreaksProblem, rowSellingPrice, tierRanges } from "@/lib/pricingMath";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import { FieldColumn, FieldLabel } from "./pricingAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// A sub-assembly's (or part's) OWN selling price (Ray, 2026-10-14) — so one
// New Product worksheet can price a few parts individually, each with its own
// quantity breaks. Independent of the product price below the rows.
//
// * Off by default: "Sell separately" turns it on, "Stop selling separately"
//   clears it (written as a blank Pricing column on Save).
// * Priced on ONE of the row, at its own cost with its own overhead.
// * The discount is the WORKSHEET's unless this row overrides it — a part that
//   sells in another MPG. Blank = the worksheet's, said beside the box.
// * Edits the DRAFT, like everything else on the worksheet; Save writes it.
// =============================================================================

const KINDS: { kind: PriceInput["kind"]; label: string; field: string }[] = [
  { kind: "gm", label: "Target GM", field: "Target base GM" },
  { kind: "list", label: "List", field: "List price" },
  { kind: "customer", label: "Customer", field: "Customer price" },
];

const asNumber = (raw: string): number => (raw.trim() === "" ? Number.NaN : Number(raw));

export function RowSellingPrice({
  draft,
  onChange,
  readOnly,
  worksheetDiscountPct,
  label,
}: {
  draft: SubAssemblyDraft;
  onChange: (next: SubAssemblyDraft) => void;
  readOnly: boolean;
  worksheetDiscountPct: number;
  label: string;
}) {
  // The value boxes hold what's typed; the draft holds NaN for a blank box,
  // which rowSellingPrice reports rather than pricing at 0.
  const [valueText, setValueText] = useState(() =>
    draft.pricing && Number.isFinite(draft.pricing.input.value) ? String(draft.pricing.input.value) : "",
  );
  const [discountText, setDiscountText] = useState(() =>
    draft.pricing?.distributorDiscountPct != null ? String(draft.pricing.distributorDiscountPct) : "",
  );

  if (draft.pricingCorrupt) {
    return (
      <p role="alert" className="mt-3 rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-xs text-fg">
        This row's saved selling price couldn't be read, so ARC won't write over it. Check its Pricing column in
        SharePoint.
      </p>
    );
  }

  const pricing = draft.pricing;
  if (!pricing) {
    if (readOnly) return null;
    return (
      <button
        type="button"
        onClick={() => {
          setValueText("");
          setDiscountText("");
          onChange({ ...draft, pricing: { input: { kind: "gm", value: Number.NaN }, distributorDiscountPct: null, priceBreaks: [] } });
        }}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
        title="Give this its own selling price and quantity breaks, to quote it on its own"
      >
        <Tag className="h-3.5 w-3.5" /> Sell {label} separately
      </button>
    );
  }

  const set = (patch: Partial<RowPricing>) => onChange({ ...draft, pricing: { ...pricing, ...patch } });
  const sell = rowSellingPrice({ name: label, lines: draft.lines, overheadPct: draft.overheadPct, pricing }, worksheetDiscountPct)!;
  const field = KINDS.find((k) => k.kind === pricing.input.kind)!;
  const tiers = pricing.priceBreaks;
  const ranges = tierRanges(tiers);
  const breakProblem = priceBreaksProblem(tiers);
  const setTiers = (next: PriceBreakTier[]) => set({ priceBreaks: next });
  const overridden = pricing.distributorDiscountPct !== null;

  return (
    <section aria-label={`${label} — own selling price`} className="mt-3 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          <Tag className="h-3.5 w-3.5" /> Own selling price
        </h3>
        {!readOnly && (
          <button
            type="button"
            onClick={() => onChange({ ...draft, pricing: null })}
            className="text-xs text-fg-muted hover:text-cooper-red"
          >
            Stop selling separately
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-3">
        <FieldColumn
          header={
            <div role="radiogroup" aria-label={`Price ${label} from`} className="inline-flex h-6 items-stretch gap-0.5 rounded-md bg-surface p-0.5">
              {KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={pricing.input.kind === k.kind}
                  disabled={readOnly}
                  onClick={() => {
                    setValueText("");
                    set({ input: { kind: k.kind, value: Number.NaN } });
                  }}
                  className={cn(
                    "rounded px-2 text-[11px] font-semibold uppercase tracking-wider",
                    pricing.input.kind === k.kind ? "bg-surface-2 text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
          }
          hint={pricing.input.kind === "gm" ? "Rounded to the dollar." : pricing.input.kind === "customer" ? "The list is worked back from it." : "Taken as typed."}
        >
          {pricing.input.kind !== "gm" && <span className="text-fg-muted">$</span>}
          <input
            type="number"
            step="any"
            aria-label={`${field.field} for ${label}`}
            value={valueText}
            disabled={readOnly}
            onChange={(e) => {
              setValueText(e.target.value);
              set({ input: { kind: pricing.input.kind, value: asNumber(e.target.value) } });
            }}
            className={cn("input !h-9 text-right tabular-nums", pricing.input.kind === "gm" ? "!w-20" : "!w-28")}
          />
          {pricing.input.kind === "gm" && <span className="text-fg-muted">%</span>}
        </FieldColumn>

        <FieldColumn
          header={<FieldLabel>Distributor discount</FieldLabel>}
          hint={overridden ? `This row only — the worksheet's is ${worksheetDiscountPct}%.` : `The worksheet's (${worksheetDiscountPct}%).`}
        >
          <input
            type="number"
            step="any"
            aria-label={`Distributor discount for ${label}`}
            placeholder={String(worksheetDiscountPct)}
            value={discountText}
            disabled={readOnly}
            onChange={(e) => {
              setDiscountText(e.target.value);
              const n = e.target.value.trim() === "" ? null : Number(e.target.value);
              set({ distributorDiscountPct: n === null || !Number.isFinite(n) ? null : n });
            }}
            className="input !h-9 !w-20 text-right tabular-nums"
          />
          <span className="text-fg-muted">%</span>
        </FieldColumn>
      </div>

      <dl className="mt-3 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4" aria-label={`${label} — own price`}>
        <Figure label="Cost each" value={formatMoney(sell.cost)} title="One of this row, with its overhead" />
        <Figure label="List price" value={formatMoney(sell.result.listPrice)} strong />
        <Figure label="Customer price" value={formatMoney(sell.result.distributorPrice)} strong />
        <Figure label="Base GM" value={formatPct(sell.result.baseGM)} strong />
      </dl>
      {sell.result.problem && <p className="mt-1 text-xs text-cooper-red">{sell.result.problem}</p>}

      <div className="mt-3">
        <div className="flex max-w-lg items-center justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Quantity breaks</h4>
          {!readOnly && tiers.length < MAX_PRICE_BREAKS && (
            <button
              type="button"
              onClick={() => {
                const lastQty = tiers[tiers.length - 1]?.minQty ?? 1;
                setTiers([...tiers, { minQty: lastQty < 10 ? 10 : lastQty * 5, discountPct: 5 }]);
              }}
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Plus className="h-3 w-3" /> Add break
            </button>
          )}
        </div>
        {tiers.length === 0 ? (
          <p className="mt-1 text-xs text-fg-muted">No quantity breaks — one price at every quantity.</p>
        ) : (
          <table className="mt-1 w-full max-w-lg text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">Quantity</th>
                <th className="px-2 py-1 text-left font-semibold">From</th>
                <th className="px-2 py-1 text-left font-semibold">% off list</th>
                <th className="px-2 py-1 text-right font-semibold">Price each</th>
                <th className="px-2 py-1 text-right font-semibold">Base GM</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tiers.map((t, i) => {
                const priced = sell.breaks.find((b) => b.minQty === t.minQty);
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1">{ranges[i + 1]}</td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        min={2}
                        aria-label={`${label} break ${i + 1} quantity`}
                        value={t.minQty}
                        disabled={readOnly}
                        onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, minQty: Number(e.target.value) } : x)))}
                        className="input !h-8 !w-20 tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="any"
                        aria-label={`${label} break ${i + 1} discount`}
                        value={t.discountPct}
                        disabled={readOnly}
                        onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, discountPct: Number(e.target.value) } : x)))}
                        className="input !h-8 !w-20 tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatMoney(priced?.price ?? null)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatPct(priced?.baseGM ?? null)}</td>
                    <td className="px-2 py-1 text-right">
                      {!readOnly && (
                        <button
                          type="button"
                          aria-label={`Remove ${label} break ${i + 1}`}
                          onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                          className="rounded p-0.5 text-fg-muted hover:text-cooper-red"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {breakProblem && <p className="mt-1 text-xs text-cooper-red">{breakProblem}</p>}
      </div>
    </section>
  );
}

function Figure({ label, value, strong, title }: { label: string; value: string; strong?: boolean; title?: string }) {
  return (
    <div title={title}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className={cn("mt-0.5 tabular-nums text-fg", strong ? "text-base font-semibold" : "text-sm")}>{value}</dd>
    </div>
  );
}
