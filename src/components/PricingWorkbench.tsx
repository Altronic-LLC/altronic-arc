import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type {
  CostSource,
  CustomerDiscountSource,
  DiscountSource,
  PriceInput,
  PricingHistoryRecord,
  PricingRequest,
} from "@/types/pricing";
import {
  STANDARD_DISTRIBUTOR_DISCOUNT_PCT,
  familyPrefix,
  priceFromInput,
  summarizePanel,
  type ComparablesPanel,
} from "@/lib/pricingMath";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import { useComparables, useCustomerDiscount, useMpgDistributorDiscount, useSapPart } from "@/hooks/usePricingLookup";
import { usePriceRequest, useSetPricingRequestMpg } from "@/hooks/usePricingRequests";
import { SAP_DATA_CONNECTED } from "@/api/pricingLookup";
import { FieldColumn, FieldLabel, PRICE_PANEL, PricingCard } from "./pricingAtoms";
import { ChoicePills } from "./ChoicePills";
import { cn } from "@/lib/cn";

// =============================================================================
// The pricing manager's panel on a request — cost, distributor discount,
// target GM or list price, the result, and the two comparison panels.
//
// Every figure is worked out by lib/pricingMath.ts; this file only gathers
// the inputs. Cost and both discounts start from SAP and stay EDITABLE (Ray,
// 2026-10-13); the source of each is saved with the price, so the history
// says whether a figure was SAP's or typed.
//
// Shown ONLY to someone `seePricingCostGate` allows — and the data behind it
// sits on lists and warehouse items a requester has no permission to read.
// =============================================================================

function toNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const fmtInput = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function PricingWorkbench({
  request,
  history,
  canPrice,
}: {
  request: PricingRequest;
  history: PricingHistoryRecord | null;
  canPrice: boolean;
}) {
  const price = usePriceRequest();
  const setMpg = useSetPricingRequestMpg();
  const sapPart = useSapPart({ altronicPartNumber: request.altronicPartNumber, sapPartNumber: request.sapPartNumber });
  // The material price group: SAP's when SAP has one for the part; otherwise
  // the one a manager TYPED (Ray, 2026-10-15), saved on the request — so a
  // part SAP hasn't classified (or SAP not connected) can still be compared.
  const sapMpg = sapPart.data?.mpg || "";
  const mpg = sapMpg || request.mpg;
  const [mpgText, setMpgText] = useState(request.mpg);
  useEffect(() => setMpgText(request.mpg), [request.mpg]);
  const mpgDiscount = useMpgDistributorDiscount(mpg);
  // THIS customer's discount (Ray, 2026-10-15): their group's on the material,
  // else on the MPG, else 34% — and 34% with no customer. It comes off the
  // list; the distributor discount above is what turns a target GM INTO the
  // list, so the list is the same whoever the customer is.
  const customerDiscount = useCustomerDiscount({
    customerGroup: request.customerGroup,
    sapPartNumber: sapPart.data?.sapPartNumber || request.sapPartNumber,
    mpg,
  });
  const resolvedCustomer = customerDiscount.discount;
  const subject = { altronicPartNumber: request.altronicPartNumber, sapPartNumber: request.sapPartNumber };
  const prefix = familyPrefix(request.altronicPartNumber);
  const mpgPanel = useComparables("mpg", mpg || null, subject);
  const familyPanel = useComparables("family", prefix, subject);

  const last = history?.history[history.history.length - 1] ?? null;
  const locked = !canPrice || request.status === "Priced" || request.status === "Cancelled";

  // The inputs, as typed. Seeded from SAP (or the last pricing) once, and
  // never overwritten after the manager has touched them.
  const [cost, setCost] = useState(fmtInput(last?.cost));
  const [costTouched, setCostTouched] = useState(!!last);
  const [discount, setDiscount] = useState(fmtInput(last?.distributorDiscountPct));
  const [discountTouched, setDiscountTouched] = useState(!!last);
  const [custDiscount, setCustDiscount] = useState(fmtInput(last?.customerDiscountPct));
  const [custDiscountTouched, setCustDiscountTouched] = useState(!!last && last.customerDiscountPct !== null);
  const [inputKind, setInputKind] = useState<PriceInput["kind"]>(last?.input.kind ?? "gm");
  const [inputValue, setInputValue] = useState(fmtInput(last?.input.value));
  const [note, setNote] = useState("");
  // Does the part stay "Contact Factory"? The manager must answer before the
  // price is set; it is written to the request beside the price, where the
  // requester reads it (Ray, 2026-10-14). Seeded from the last answer.
  const [contactFactory, setContactFactory] = useState<"" | "Yes" | "No">(
    yesNo(request.leaveAsContactFactory ?? last?.leaveAsContactFactory ?? null),
  );

  const sapCost = sapPart.data?.cost ?? null;
  const sapMpgDiscount = mpgDiscount.data ?? null;

  useEffect(() => {
    if (!costTouched && sapCost !== null) setCost(String(sapCost));
  }, [sapCost, costTouched]);
  useEffect(() => {
    if (discountTouched) return;
    if (sapMpgDiscount !== null) setDiscount(String(sapMpgDiscount));
    else if (!mpgDiscount.isLoading) setDiscount(String(STANDARD_DISTRIBUTOR_DISCOUNT_PCT));
  }, [sapMpgDiscount, mpgDiscount.isLoading, discountTouched]);
  useEffect(() => {
    if (!custDiscountTouched && resolvedCustomer) setCustDiscount(String(resolvedCustomer.pct));
  }, [resolvedCustomer?.pct, resolvedCustomer?.source, custDiscountTouched]);

  const costNum = toNumber(cost);
  const discountNum = toNumber(discount) ?? STANDARD_DISTRIBUTOR_DISCOUNT_PCT;
  // The customer's price is list less THEIR discount (Ray, 2026-10-15) — it
  // replaced "the customer's price IS the distributor price" (2026-10-13).
  const customerDiscountNum = toNumber(custDiscount) ?? STANDARD_DISTRIBUTOR_DISCOUNT_PCT;
  const customerDiscountSource: CustomerDiscountSource =
    resolvedCustomer && customerDiscountNum === resolvedCustomer.pct ? resolvedCustomer.source : "Manual";
  const inputNum = toNumber(inputValue);

  const costSource: CostSource = sapCost !== null && costNum === sapCost ? "SAP" : "Manual";
  const discountSource: DiscountSource =
    sapMpgDiscount !== null && discountNum === sapMpgDiscount
      ? "SAP"
      : sapMpgDiscount === null && discountNum === STANDARD_DISTRIBUTOR_DISCOUNT_PCT
        ? "Default"
        : "Manual";

  const result = useMemo(
    () =>
      priceFromInput({
        cost: costNum,
        distributorDiscountPct: discountNum,
        input: inputNum === null ? null : { kind: inputKind, value: inputNum },
        customerDiscountPct: customerDiscountNum,
      }),
    [costNum, discountNum, inputKind, inputNum, customerDiscountNum],
  );

  function saveMpg() {
    const next = mpgText.trim().toUpperCase();
    setMpgText(next);
    if (next !== request.mpg) setMpg.mutate({ id: request.id, mpg: next });
  }

  const canSubmit =
    !locked && result.listPrice !== null && costNum !== null && contactFactory !== "" && !price.isPending;

  function submit() {
    if (!canSubmit || result.listPrice === null || costNum === null || inputNum === null) return;
    price.mutate({
      id: request.id,
      entry: {
        cost: costNum,
        costSource,
        distributorDiscountPct: discountNum,
        discountSource,
        input: { kind: inputKind, value: inputNum },
        listPrice: result.listPrice,
        baseGM: result.baseGM,
        customerGroup: request.customerGroup,
        customerDiscountPct: customerDiscountNum,
        customerDiscountSource,
        customerPrice: result.customerPrice,
        customerGM: result.customerGM,
        mpg: mpg && mpgPanel.data ? summarizePanel(mpg, mpgPanel.data) : null,
        family: prefix && familyPanel.data ? summarizePanel(prefix, familyPanel.data) : null,
        leaveAsContactFactory: contactFactory === "Yes",
        note: note.trim(),
      },
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="pricing-workbench">
      {!SAP_DATA_CONNECTED && (
        <p className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 px-4 py-3 text-sm text-fg">
          SAP costing data isn't connected to ARC yet, so cost and discounts are typed in and there are no comparables.
        </p>
      )}

      <PricingCard title="Price this request" tone="price">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <FieldColumn
            header={<FieldLabel>Material price group</FieldLabel>}
            hint={
              sapMpg
                ? "SAP's for this part."
                : locked
                  ? request.mpg
                    ? "Typed — SAP has none for this part."
                    : "None — SAP has none for this part."
                  : "SAP has none — type one to compare. Saved on the request."
            }
          >
            {sapMpg || locked ? (
              <span className="text-sm font-medium text-fg">{mpg || "—"}</span>
            ) : (
              <input
                aria-label="Material price group"
                value={mpgText}
                maxLength={20}
                placeholder="e.g. CTL"
                onChange={(e) => setMpgText(e.target.value.toUpperCase())}
                onBlur={saveMpg}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveMpg();
                  }
                }}
                className="input !h-9 !w-24 uppercase"
              />
            )}
          </FieldColumn>
          <NumberField
            label="Cost"
            prefix="$"
            width="!w-32"
            value={cost}
            onChange={(v) => {
              setCost(v);
              setCostTouched(true);
            }}
            disabled={locked}
            source={costSource === "SAP" ? "from SAP" : sapCost !== null ? `typed — SAP has ${formatMoney(sapCost)}` : "typed"}
          />
          <NumberField
            label="Distributor discount"
            suffix="%"
            width="!w-20"
            value={discount}
            onChange={(v) => {
              setDiscount(v);
              setDiscountTouched(true);
            }}
            disabled={locked}
            source={
              discountSource === "SAP"
                ? `SAP's for ${mpg}`
                : discountSource === "Default"
                  ? `standard ${STANDARD_DISTRIBUTOR_DISCOUNT_PCT}% — SAP has none${mpg ? ` for ${mpg}` : ""}`
                  : "typed"
            }
          />
          <NumberField
            label="Customer discount"
            suffix="%"
            width="!w-20"
            value={custDiscount}
            onChange={(v) => {
              setCustDiscount(v);
              setCustDiscountTouched(true);
            }}
            disabled={locked}
            source={customerDiscountHint(customerDiscountSource, request.customerGroup, mpg)}
          />
          <NumberField
            label={inputKind === "gm" ? "Target base GM" : "List price"}
            header={
              // The toggle sits in the LABEL row, at the label row's height,
              // so this box lines up with Cost and Discount beside it.
              <div role="radiogroup" aria-label="Price from" className="inline-flex h-6 items-stretch gap-0.5 rounded-md bg-surface-2 p-0.5">
                {(["gm", "list"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={inputKind === k}
                    disabled={locked}
                    onClick={() => {
                      setInputKind(k);
                      setInputValue("");
                    }}
                    className={cn(
                      "rounded px-2 text-[11px] font-semibold uppercase tracking-wider",
                      inputKind === k ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {k === "gm" ? "Target GM" : "List price"}
                  </button>
                ))}
              </div>
            }
            prefix={inputKind === "list" ? "$" : undefined}
            suffix={inputKind === "gm" ? "%" : undefined}
            width={inputKind === "gm" ? "!w-20" : "!w-32"}
            value={inputValue}
            onChange={setInputValue}
            disabled={locked}
            source={inputKind === "gm" ? "Rounded to the dollar." : "Taken as typed."}
          />
          <FieldColumn
            header={<FieldLabel>Leave as Contact Factory?</FieldLabel>}
            hint={contactFactory === "" && !locked ? "Required — the requester sees this." : "The requester sees this."}
          >
            <ChoicePills
              label="Leave as Contact Factory?"
              name="leave-as-contact-factory"
              options={["Yes", "No"]}
              value={contactFactory}
              onChange={(v) => setContactFactory(v as "Yes" | "No")}
              disabled={locked}
            />
          </FieldColumn>
        </div>

        <dl className={cn("mt-4 grid max-w-3xl grid-cols-2 gap-3 p-3 sm:grid-cols-4", PRICE_PANEL)} aria-label="Result">
          <Result label="List price" value={formatMoney(result.listPrice)} strong />
          <Result label="Base GM" value={formatPct(result.baseGM)} />
          <Result label={`Price for ${request.customerName || "the customer"}`} value={formatMoney(result.customerPrice)} strong />
          <Result label="Customer GM" value={formatPct(result.customerGM)} />
        </dl>
        {result.problem && inputValue.trim() !== "" && (
          <p className="mt-2 text-xs text-cooper-red" role="alert">
            {result.problem}
          </p>
        )}
        {inputKind === "gm" && result.baseGM !== null && inputNum !== null && Math.abs(result.baseGM - inputNum) >= 0.05 && (
          <p className="mt-2 text-xs text-fg-muted">
            Rounding the list price to the dollar moves the margin from {formatPct(inputNum)} to {formatPct(result.baseGM)}.
          </p>
        )}

        {!locked && (
          <>
            <label className="mt-4 flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Why this price (saved with it)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input max-w-3xl" />
            </label>
            <div className="mt-3 flex max-w-3xl justify-end">
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50"
              >
                {price.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {history?.history.length ? "Save new price" : "Set price"}
              </button>
            </div>
          </>
        )}
        {locked && request.status === "Priced" && canPrice && (
          <p className="mt-3 text-xs text-fg-muted">Reopen the request to change its price.</p>
        )}
      </PricingCard>

      <ComparablesCard
        title={mpg ? `Material price group ${mpg}` : "Material price group"}
        panel={mpgPanel.data}
        loading={mpgPanel.isLoading}
        notConnected={!SAP_DATA_CONNECTED || mpgPanel.notConnected}
        emptyReason={
          mpg ? null : canPrice ? "No material price group yet — type one under Price this request to compare." : "SAP hasn't given this part a material price group."
        }
      />
      <ComparablesCard
        title={prefix ? `Family ${prefix}…` : "Family"}
        panel={familyPanel.data}
        loading={familyPanel.isLoading}
        notConnected={!SAP_DATA_CONNECTED || familyPanel.notConnected}
        emptyReason={prefix ? null : "The Altronic number doesn't start with six digits."}
      />

      {history && history.history.length > 0 && <PriceHistoryCard history={history} />}
    </div>
  );
}

/** Where the customer discount came from, in words, for the field's hint. */
export function customerDiscountHint(source: CustomerDiscountSource, customerGroup: string, mpg: string): string {
  const group = customerGroup.trim();
  if (source === "Material") return `SAP's for group ${group} on this part`;
  if (source === "MPG") return `SAP's for group ${group} on ${mpg}`;
  if (source === "Default") {
    return group
      ? `standard ${STANDARD_DISTRIBUTOR_DISCOUNT_PCT}% — SAP has none for group ${group}`
      : `standard ${STANDARD_DISTRIBUTOR_DISCOUNT_PCT}% — no customer`;
  }
  return "typed";
}

function NumberField({
  label,
  header,
  value,
  onChange,
  disabled,
  prefix,
  suffix,
  source,
  width = "!w-28",
}: {
  /** The input's accessible name; drawn as the label unless `header` replaces it. */
  label: string;
  header?: ReactNode;
  width?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  prefix?: string;
  suffix?: string;
  source?: string;
}) {
  return (
    <FieldColumn header={header ?? <FieldLabel>{label}</FieldLabel>} hint={source}>
      {prefix && <span className="text-fg-muted">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        step="any"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn("input !h-9 tabular-nums text-right", width)}
      />
      {suffix && <span className="text-fg-muted">{suffix}</span>}
    </FieldColumn>
  );
}

function Result({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className={cn("mt-0.5 tabular-nums text-fg", strong ? "text-lg font-semibold" : "text-sm")}>{value}</dd>
    </div>
  );
}

function ComparablesCard({
  title,
  panel,
  loading,
  notConnected,
  emptyReason,
}: {
  title: string;
  panel: ComparablesPanel | undefined;
  loading: boolean;
  notConnected: boolean;
  emptyReason: string | null;
}) {
  const summary = panel ? (
    <span className="text-xs font-normal normal-case tracking-normal text-fg">
      Average base GM <strong>{formatPct(panel.averageGM)}</strong> over {panel.counted} part
      {panel.counted === 1 ? "" : "s"}
      {panel.excluded > 0 && <span className="text-fg-muted"> · {panel.excluded} left out</span>}
    </span>
  ) : null;
  return (
    <PricingCard title={title} action={summary} tone="reference">
      {notConnected ? (
        <p className="text-sm text-fg-muted">Comparables appear here once SAP data is connected.</p>
      ) : emptyReason ? (
        <p className="text-sm text-fg-muted">{emptyReason}</p>
      ) : loading || !panel ? (
        <p className="text-sm text-fg-muted">Loading comparables…</p>
      ) : panel.rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No other parts in SAP to compare with.</p>
      ) : (
        <div className="scroll-elegant overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-2 py-1.5 font-semibold">Part</th>
                <th className="px-2 py-1.5 font-semibold">Description</th>
                <th className="px-2 py-1.5 text-right font-semibold">List</th>
                <th className="px-2 py-1.5 text-right font-semibold">Disc.</th>
                <th className="px-2 py-1.5 text-right font-semibold">Cost</th>
                <th className="px-2 py-1.5 text-right font-semibold">Base GM</th>
              </tr>
            </thead>
            <tbody>
              {panel.rows.map((r) => (
                <tr key={`${r.sapPartNumber}-${r.altronicPartNumber}`} className={cn("border-t border-border", r.excluded && "text-fg-muted")}>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{r.altronicPartNumber}</td>
                  <td className="px-2 py-1.5">
                    {r.description}
                    {r.excluded && <span className="ml-2 text-[11px] italic">not counted — {r.excluded}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(r.listPrice)}</td>
                  <td
                    className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums"
                    title={r.discountIsDefault ? "SAP has no discount for this MPG — the standard 34% is used." : `SAP's discount for ${r.mpg}`}
                  >
                    {r.distributorDiscountPct}%{r.discountIsDefault && "*"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(r.cost)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums">{formatPct(r.baseGM)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-fg-muted">
            Base GM is measured at each part's distributor price. * SAP has no discount for that MPG, so the standard
            34% is used. The average is a simple average of the parts counted.
          </p>
        </div>
      )}
    </PricingCard>
  );
}

function PriceHistoryCard({ history }: { history: PricingHistoryRecord }) {
  const entries = [...history.history].reverse();
  return (
    <PricingCard title="Price history">
      {history.historyCorrupt && (
        <p role="alert" className="mb-2 text-xs text-cooper-red">
          The saved history couldn't be read — ARC won't write over it until it's checked in SharePoint.
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {entries.map((e) => (
          <li key={e.pricedAt} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-fg">{formatMoney(e.listPrice)} list</span>
              <span className="text-xs text-fg-muted">
                {e.pricedBy.displayName} · {new Date(e.pricedAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              Cost {formatMoney(e.cost)} ({e.costSource}) · distributor discount {e.distributorDiscountPct}% ({e.discountSource}) ·
              {e.customerDiscountPct !== null &&
                ` customer discount ${e.customerDiscountPct}%${e.customerDiscountSource ? ` (${e.customerDiscountSource})` : ""} ·`}
              base GM {formatPct(e.baseGM)}
              {e.customerPrice !== null && ` · customer ${formatMoney(e.customerPrice)} (${formatPct(e.customerGM)})`}
              {e.input.kind === "gm" ? ` · from a ${e.input.value}% target` : " · list typed"}
              {e.leaveAsContactFactory !== undefined && ` · Contact Factory: ${e.leaveAsContactFactory ? "Yes" : "No"}`}
            </p>
            {(e.mpg || e.family) && (
              <p className="mt-1 text-xs text-fg-muted">
                {e.mpg && `MPG ${e.mpg.key} avg ${formatPct(e.mpg.averageGM)} (${e.mpg.counted})`}
                {e.mpg && e.family && " · "}
                {e.family && `Family ${e.family.key} avg ${formatPct(e.family.averageGM)} (${e.family.counted})`}
              </p>
            )}
            {e.note && <p className="mt-1 whitespace-pre-wrap text-fg">{e.note}</p>}
          </li>
        ))}
      </ol>
    </PricingCard>
  );
}

function yesNo(v: boolean | null): "" | "Yes" | "No" {
  return v === null ? "" : v ? "Yes" : "No";
}
