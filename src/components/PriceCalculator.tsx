import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Check, Copy, Loader2, Search, X } from "lucide-react";
import { useMyPricingAccess } from "@/hooks/usePricingRoles";
import { useSapMaterialCosts } from "@/hooks/usePricingLookup";
import {
  describeSapCostFailure,
  needsSapSignIn,
  SAP_COST_DEMO_EXAMPLE,
  SAP_COST_LOOKUP_IS_DEMO,
  warmSapCostLookup,
} from "@/api/pricingLookup";
import { signInToFabric } from "@/api/fabric";
import { sapMaterialLookupKey } from "@/lib/sapMaterialCost";
import { formatSapPartNumber } from "@/lib/sapPartNumber";
import { calculate, gmLadder, resultsText, type CalcMode } from "@/lib/priceCalculator";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import { FieldColumn, FieldLabel, PRICE_PANEL } from "./pricingFields";
import { pushToast } from "./Toast";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { cn } from "@/lib/cn";

// =============================================================================
// The quick price calculator (Ray, 2026-10-15) — a Calculator button on the
// Pricing bar, so it's found in the Pricing tool and nowhere else, for every
// pricing role (requester, manager or admin). A scratch pad: a
// description, the cost, then a target GM or a price, and it shows the
// CUSTOMER price (no list price) with a ladder of prices at ROUND GMs (5, 10,
// 15 … — from 10 points below the result to 20 above). Copy puts it all on the clipboard. Nothing is saved — the
// figures live only while the dialog is open (kept if it's closed and
// reopened in the same session, so a quick look elsewhere loses nothing).
// The maths is `lib/priceCalculator.ts`.
// =============================================================================

const asNumber = (raw: string): number | null => (raw.trim() === "" ? null : Number(raw));

/** The Pricing bar's Calculator button — renders nothing without Pricing access. */
export function PriceCalculatorButton() {
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
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <Calculator className="h-3.5 w-3.5" />
        Calculator
      </button>
      {open && <PriceCalculatorDialog onClose={() => setOpen(false)} />}
    </>
  );
}

// Kept for the session so closing and reopening doesn't lose what was typed.
const session = { sap: "", description: "", cogs: "", mode: "gm" as CalcMode, value: "" };

/** Tests only — the session store is module state, so each test starts clean. */
export function __resetPriceCalculatorSession() {
  Object.assign(session, { sap: "", description: "", cogs: "", mode: "gm", value: "" });
}

export function PriceCalculatorDialog({ onClose }: { onClose: () => void }) {
  const [sap, setSap] = useState(session.sap);
  // The SAP number last LOOKED UP — the lookup runs on demand, not per keystroke.
  const [lookedUp, setLookedUp] = useState("");
  const [description, setDescription] = useState(session.description);
  const [cogs, setCogs] = useState(session.cogs);
  const [mode, setMode] = useState<CalcMode>(session.mode);
  const [value, setValue] = useState(session.value);
  const [copied, setCopied] = useState(false);
  const overlay = useOverlayDismiss(onClose);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Object.assign(session, { sap, description, cogs, mode, value });
  }, [sap, description, cogs, mode, value]);

  // SAP's current cost (Ray, 2026-10-15), read from the Fabric view
  // `rpt.vw_cogs_material_api` by SAP number only — kept narrow for speed. A
  // material has a row per plant: the first plant's cost is brought in, and a
  // picker offers the rest.
  // Applied ONCE per lookup (and per plant pick), so typing over the cost
  // afterwards sticks.
  // Wake the live lookup as the dialog opens, so the first part looked up
  // doesn't also pay for the sign-in token and a cold Fabric endpoint.
  useEffect(() => {
    void warmSapCostLookup();
  }, []);
  const costs = useSapMaterialCosts(lookedUp, lookedUp !== "");
  const plants = useMemo(() => costs.data ?? [], [costs.data]);
  const [plant, setPlant] = useState("");
  const row = plants.find((p) => p.plant === plant) ?? plants[0] ?? null;
  const [sapCost, setSapCost] = useState<number | null>(null);
  const applied = useRef("");
  // Bumped by every Look up, so pressing it again on the SAME number re-applies
  // SAP's figures (lookedUp alone doesn't change, so the effect wouldn't run).
  const [lookupSeq, setLookupSeq] = useState(0);
  // The description SAP last put in the box — so a part SAP doesn't hold can
  // clear it (it described the previous part) without touching typed text.
  const sapDescription = useRef<string | null>(null);
  useEffect(() => {
    if (!lookedUp || !costs.isSuccess || applied.current === lookedUp) return;
    applied.current = lookedUp;
    const firstPlant = plants[0];
    if (firstPlant) {
      setPlant(firstPlant.plant);
      applyCost(firstPlant.unitCost);
    }
    const next = firstPlant?.description ?? "";
    setDescription((d) => {
      if (next) {
        sapDescription.current = next;
        return next;
      }
      const stale = sapDescription.current !== null && d === sapDescription.current;
      sapDescription.current = null;
      return stale ? "" : d;
    });
  }, [plants, lookedUp, costs.isSuccess, lookupSeq]);

  function applyCost(unitCost: number | null) {
    setSapCost(unitCost);
    if (unitCost !== null) setCogs(String(unitCost));
  }

  function pickPlant(next: string) {
    setPlant(next);
    applyCost(plants.find((p) => p.plant === next)?.unitCost ?? null);
  }

  const whole = sapMaterialLookupKey(sap) !== null;
  const [signingIn, setSigningIn] = useState(false);
  const signInNeeded = costs.isError && needsSapSignIn(costs.error);

  async function signIn() {
    setSigningIn(true);
    try {
      await signInToFabric();
      await costs.refetch();
    } catch (err) {
      pushToast({ message: `Couldn't sign in to SAP: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSigningIn(false);
    }
  }

  // Look up the moment the 10th digit lands — no waiting for a click. The
  // button stays for looking the same number up again.
  useEffect(() => {
    const pn = sapMaterialLookupKey(sap);
    if (pn && pn !== lookedUp) lookUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sap]);

  function lookUp() {
    const pn = sapMaterialLookupKey(sap);
    if (!pn) return;
    applied.current = "";
    setLookedUp(pn);
    setLookupSeq((n) => n + 1);
    setPlant("");
    setSapCost(null);
  }

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
    const sapPartNumber = row ? (plants.length > 1 ? `${row.sapPartNumber}, plant ${row.plant}` : row.sapPartNumber) : "";
    const text = resultsText({ description, sapPartNumber, cogs: cost, mode, result, ladder });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast({ message: "Couldn't copy — your browser blocked the clipboard. Select the figures and copy them instead." });
    }
  }

  function sapHint(): string {
    if (!lookedUp) return sap.trim() && !whole ? "All 10 digits, like 9100-0002-00." : "Enter it and press Look up.";
    if (costs.isFetching) return "Looking it up in SAP…";
    if (costs.isError) return describeSapCostFailure(costs.error);
    if (!row) {
      return SAP_COST_LOOKUP_IS_DEMO
        ? `${lookedUp} isn't in the demo data — the demo isn't connected to SAP. Try ${SAP_COST_DEMO_EXAMPLE}.`
        : `SAP doesn't have ${lookedUp}.`;
    }
    if (row.unitCost === null) return `SAP has no cost for ${row.sapPartNumber || lookedUp} at plant ${row.plant} — type it.`;
    return "Cost and description brought in.";
  }

  function clear() {
    setSap("");
    setLookedUp("");
    setPlant("");
    sapDescription.current = null;
    setSapCost(null);
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
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-fg-muted">A quick customer price from cost and margin. Nothing is saved.</p>

        <div className="mb-3">
          <FieldColumn header={<FieldLabel>SAP part #</FieldLabel>} hint={sapHint()}>
            <input
              ref={first}
              aria-label="SAP part number"
              value={sap}
              onChange={(e) => setSap(formatSapPartNumber(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  lookUp();
                }
              }}
              placeholder="Optional — brings in SAP's cost"
              className="input h-9! w-56! font-mono text-sm"
            />
            <button
              type="button"
              onClick={lookUp}
              disabled={!whole || costs.isFetching}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
            >
              {costs.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Look up
            </button>
            {signInNeeded && (
              <button
                type="button"
                onClick={() => void signIn()}
                disabled={signingIn}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {signingIn && <Loader2 className="h-4 w-4 animate-spin" />}
                Sign in to SAP
              </button>
            )}
          </FieldColumn>
          {/* A material has a row per plant — offer the others, each with its cost. */}
          {plants.length > 1 && (
            <div role="radiogroup" aria-label="Plant" className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Plant</span>
              {plants.map((p) => (
                <button
                  key={p.plant}
                  type="button"
                  role="radio"
                  aria-checked={row?.plant === p.plant}
                  onClick={() => pickPlant(p.plant)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs tabular-nums",
                    row?.plant === p.plant
                      ? "border-cooper-green bg-cooper-green/10 font-semibold text-fg"
                      : "border-border text-fg-muted hover:text-fg",
                  )}
                >
                  {p.plant} · {formatMoney(p.unitCost)}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1 text-xs">
          <FieldLabel>Description</FieldLabel>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what you're pricing"
            className="input h-9!"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
          <FieldColumn header={<FieldLabel>COGS</FieldLabel>} hint={
              sapCost !== null && asNumber(cogs) === sapCost
                ? plants.length > 1 && row
                  ? `From SAP — plant ${row.plant}'s current cost.`
                  : "From SAP — current cost."
                : "Cost of one."
            }>
            <span className="text-fg-muted">$</span>
            <input
              type="number"
              min={0}
              step="any"
              aria-label="COGS"
              value={cogs}
              onChange={(e) => setCogs(e.target.value)}
              className="input h-9! w-28! text-right tabular-nums"
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
                      "rounded-sm px-2 text-[11px] font-semibold uppercase tracking-wider",
                      mode === m ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
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
              className={cn("input h-9! text-right tabular-nums", mode === "gm" ? "w-20!" : "w-28!")}
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
                  key={r.current ? "current" : r.gm}
                  aria-current={r.current || undefined}
                  className={cn("border-t border-border", r.current && "bg-cooper-green/10 font-semibold")}
                >
                  <td className="px-2 py-1 tabular-nums">
                    {formatPct(r.gm)}
                    {r.current && <span className="ml-2 text-[11px] font-normal text-fg-muted">this price</span>}
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
