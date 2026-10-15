import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Check, Copy, X } from "lucide-react";
import { useMyPricingAccess } from "@/hooks/usePricingRoles";
import { calculate, gmLadder, resultsText, type CalcMode } from "@/lib/priceCalculator";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import { FieldColumn, FieldLabel, PRICE_PANEL } from "./pricingAtoms";
import { pushToast } from "./Toast";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { cn } from "@/lib/cn";

// =============================================================================
// The quick price calculator (Ray, 2026-10-15) — a header button for everyone
// with Pricing access (requester, manager or admin). A scratch pad: a
// description, the cost, then a target GM or a price, and it shows the
// CUSTOMER price (no list price) with a ladder of prices from 10 GM points
// below to 20 above. Copy puts it all on the clipboard. Nothing is saved — the
// figures live only while the dialog is open (kept if it's closed and
// reopened in the same session, so a quick look elsewhere loses nothing).
// The maths is `lib/priceCalculator.ts`.
// =============================================================================

const asNumber = (raw: string): number | null => (raw.trim() === "" ? null : Number(raw));

/** The header button — renders nothing without Pricing access. */
export function PriceCalculatorButton({ compact = false }: { compact?: boolean }) {
  const { rights } = useMyPricingAccess();
  const [open, setOpen] = useState(false);
  if (!rights.canAccess) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Price calculator"
        aria-label="Price calculator"
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
          compact ? "h-8 w-8 shrink-0 justify-center" : "h-9 px-2.5",
        )}
      >
        <Calculator className="h-4 w-4" />
        {!compact && <span className="hidden whitespace-nowrap 2xl:inline">Calculator</span>}
      </button>
      {open && <PriceCalculatorDialog onClose={() => setOpen(false)} />}
    </>
  );
}

// Kept for the session so closing and reopening doesn't lose what was typed.
const session = { description: "", cogs: "", mode: "gm" as CalcMode, value: "" };

/** Tests only — the session store is module state, so each test starts clean. */
export function __resetPriceCalculatorSession() {
  Object.assign(session, { description: "", cogs: "", mode: "gm", value: "" });
}

export function PriceCalculatorDialog({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState(session.description);
  const [cogs, setCogs] = useState(session.cogs);
  const [mode, setMode] = useState<CalcMode>(session.mode);
  const [value, setValue] = useState(session.value);
  const [copied, setCopied] = useState(false);
  const overlay = useOverlayDismiss(onClose);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Object.assign(session, { description, cogs, mode, value });
  }, [description, cogs, mode, value]);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cost = asNumber(cogs);
  const typed = asNumber(value);
  const result = useMemo(
    () => calculate({ cogs: cost, mode, gm: mode === "gm" ? typed : null, price: mode === "price" ? typed : null }),
    [cost, mode, typed],
  );
  const ladder = useMemo(
    () => (result.price !== null && cost !== null ? gmLadder(cost, mode === "gm" && typed !== null ? typed : result.gm ?? 0, result) : []),
    [result, cost, mode, typed],
  );
  const started = cogs.trim() !== "" || value.trim() !== "";

  async function copy() {
    if (result.price === null || cost === null) return;
    const text = resultsText({ description, cogs: cost, mode, result, ladder });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast({ message: "Couldn't copy — your browser blocked the clipboard. Select the figures and copy them instead." });
    }
  }

  function clear() {
    setDescription("");
    setCogs("");
    setValue("");
    first.current?.focus();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" {...overlay}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Price calculator"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Calculator className="h-5 w-5 text-cooper-green" /> Price calculator
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-fg-muted">A quick customer price from cost and margin. Nothing is saved.</p>

        <label className="flex flex-col gap-1 text-xs">
          <FieldLabel>Description</FieldLabel>
          <input
            ref={first}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what you're pricing"
            className="input !h-9"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
          <FieldColumn header={<FieldLabel>COGS</FieldLabel>} hint="Cost of one.">
            <span className="text-fg-muted">$</span>
            <input
              type="number"
              min={0}
              step="any"
              aria-label="COGS"
              value={cogs}
              onChange={(e) => setCogs(e.target.value)}
              className="input !h-9 !w-28 text-right tabular-nums"
            />
          </FieldColumn>
          <FieldColumn
            header={
              <div role="radiogroup" aria-label="Price from" className="inline-flex h-6 items-stretch gap-0.5 rounded-md bg-surface-2 p-0.5">
                {(["gm", "price"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => {
                      setMode(m);
                      setValue("");
                    }}
                    className={cn(
                      "rounded px-2 text-[11px] font-semibold uppercase tracking-wider",
                      mode === m ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {m === "gm" ? "GM wanted" : "Manual price"}
                  </button>
                ))}
              </div>
            }
            hint={mode === "gm" ? "Price = cost ÷ (1 − GM)." : "Shows the GM that price earns."}
          >
            {mode === "price" && <span className="text-fg-muted">$</span>}
            <input
              type="number"
              step="any"
              aria-label={mode === "gm" ? "GM wanted" : "Manual price"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={cn("input !h-9 text-right tabular-nums", mode === "gm" ? "!w-20" : "!w-28")}
            />
            {mode === "gm" && <span className="text-fg-muted">%</span>}
          </FieldColumn>
        </div>

        <dl className={cn("mt-4 grid grid-cols-3 gap-3 p-3", PRICE_PANEL)} aria-label="Result">
          <Figure label="Customer price" value={formatMoney(result.price)} strong />
          <Figure label="GM" value={formatPct(result.gm)} />
          <Figure label="Profit" value={formatMoney(result.profit)} />
        </dl>
        {started && result.problem && <p className="mt-2 text-xs text-cooper-red">{result.problem}</p>}

        {ladder.length > 0 && (
          <table className="mt-4 w-full text-sm" aria-label="Prices by GM">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">GM</th>
                <th className="px-2 py-1 text-right font-semibold">Customer price</th>
                <th className="px-2 py-1 text-right font-semibold">Profit</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((r) => (
                <tr
                  key={r.step}
                  aria-current={r.current || undefined}
                  className={cn("border-t border-border", r.current && "bg-cooper-green/10 font-semibold")}
                >
                  <td className="px-2 py-1 tabular-nums">
                    {formatPct(r.gm)}
                    <span className="ml-2 text-[11px] font-normal text-fg-muted">
                      {r.step === 0 ? "this price" : `${r.step > 0 ? "+" : "−"}${Math.abs(r.step)} pts`}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatMoney(r.price)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatMoney(r.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={clear} className="text-xs text-fg-muted hover:text-fg">
            Clear
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            disabled={result.price === null}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy results"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className={cn("mt-0.5 tabular-nums text-fg", strong ? "text-lg font-semibold" : "text-sm")}>{value}</dd>
    </div>
  );
}
