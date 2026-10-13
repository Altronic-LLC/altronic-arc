import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { CustomerQuoteLine, QuoteCustomerInfo } from "@/types/pricing";
import { useNewProductWorksheets } from "@/hooks/useNewProductPricing";
import { usePricingRequests } from "@/hooks/usePricingRequests";
import { useCustomerGroupDiscount, useSapPart } from "@/hooks/usePricingLookup";
import { SAP_DATA_CONNECTED } from "@/api/pricingLookup";
import { freeLine, lineFromRequest, lineFromSapPart, lineFromWorksheet } from "@/lib/customerQuotes";
import { formatMoney } from "@/lib/quoteMoney";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { cn } from "@/lib/cn";

// =============================================================================
// Add a line to a customer quote — four kinds (Ray, 2026-10-13):
//   * a New Product worksheet — its list and breaks less this customer's
//     discount, pinned to the worksheet's current revision;
//   * an existing SAP part — list price less the discount;
//   * a priced pricing request — the customer price it was given;
//   * a free-typed line — freight, tooling, NRE.
// The customer's discount comes from SAP (their group × the MPG). While SAP
// data isn't connected, or SAP has none, it is typed — and shown, so a line
// is never priced at a discount nobody saw.
// =============================================================================

type Kind = CustomerQuoteLine["kind"];

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "worksheet", label: "New product" },
  { kind: "sapPart", label: "SAP part" },
  { kind: "request", label: "Priced request" },
  { kind: "free", label: "Other line" },
];

export function QuoteLineModal({
  customer,
  onAdd,
  onClose,
}: {
  customer: QuoteCustomerInfo;
  onAdd: (line: CustomerQuoteLine) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>("worksheet");
  const [qty, setQty] = useState("1");
  const [worksheetId, setWorksheetId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [lookedUp, setLookedUp] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountTouched, setDiscountTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlay = useOverlayDismiss(onClose, false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data: worksheets = [] } = useNewProductWorksheets();
  const { data: requests = [] } = usePricingRequests();
  const priced = useMemo(
    () => worksheets.filter((w) => w.status === "Active" && w.listPrice !== null),
    [worksheets],
  );
  const pricedRequests = useMemo(
    () =>
      requests
        .filter((r) => r.status === "Priced")
        .sort((a, b) => Number(b.customerSoldTo === customer.soldTo) - Number(a.customerSoldTo === customer.soldTo)),
    [requests, customer.soldTo],
  );
  const ws = priced.find((w) => String(w.id) === worksheetId) ?? null;
  const sapPart = useSapPart({ altronicPartNumber: lookedUp, sapPartNumber: "" }, kind === "sapPart" && !!lookedUp);
  const mpg = kind === "worksheet" ? ws?.mpg ?? "" : kind === "sapPart" ? sapPart.data?.mpg ?? "" : "";
  const groupDiscount = useCustomerGroupDiscount(customer.customerGroup, mpg);

  useEffect(() => {
    if (!discountTouched) setDiscount(groupDiscount.data !== null && groupDiscount.data !== undefined ? String(groupDiscount.data) : "");
  }, [groupDiscount.data, discountTouched]);

  const quantity = Number(qty);
  const discountNum = discount.trim() === "" ? null : Number(discount);
  const preview: CustomerQuoteLine | null = (() => {
    if (!Number.isInteger(quantity) || quantity < 1) return null;
    if (discountNum !== null && (!Number.isFinite(discountNum) || discountNum < 0 || discountNum >= 100)) return null;
    if (kind === "worksheet") return ws ? lineFromWorksheet(ws, discountNum, quantity) : null;
    if (kind === "sapPart") return sapPart.data ? lineFromSapPart(sapPart.data, discountNum, quantity) : null;
    if (kind === "request") {
      const r = requests.find((x) => String(x.id) === requestId);
      return r ? lineFromRequest(r, quantity) : null;
    }
    const p = Number(price);
    return description.trim() && price.trim() !== "" && Number.isFinite(p) && p >= 0
      ? freeLine({ partNumber, description, quantity, unitPrice: p })
      : null;
  })();

  function add() {
    if (!preview) {
      setError("Fill in the line first.");
      return;
    }
    onAdd(preview);
    onClose();
  }

  const showsDiscount = kind === "worksheet" || kind === "sapPart";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" {...overlay}>
      <div role="dialog" aria-modal="true" aria-label="Add a quote line" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">Add a line</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div role="radiogroup" aria-label="Line kind" className="mb-3 inline-flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={kind === k.kind}
              onClick={() => {
                setKind(k.kind);
                setError(null);
                setDiscountTouched(false);
              }}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium", kind === k.kind ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {kind === "worksheet" && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Worksheet</span>
              <select value={worksheetId} onChange={(e) => setWorksheetId(e.target.value)} className="input" aria-label="Worksheet">
                <option value="">Pick a priced worksheet…</option>
                {priced.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.worksheetNumber} R{w.rev} — {w.productName} ({formatMoney(w.listPrice)} list)
                  </option>
                ))}
              </select>
              {priced.length === 0 && <span className="text-[11px] text-fg-muted">No worksheet has a price saved yet.</span>}
            </label>
          )}
          {kind === "sapPart" && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Altronic part #</span>
              {SAP_DATA_CONNECTED ? (
                <div className="flex gap-2">
                  <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} className="input flex-1" aria-label="Altronic part number" />
                  <button type="button" onClick={() => setLookedUp(partNumber.trim())} className="rounded-md border border-border px-3 text-sm hover:bg-surface-2">
                    Look up
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-fg-muted">SAP data isn't connected yet — add it as an Other line for now.</p>
              )}
              {lookedUp && sapPart.data === null && !sapPart.isLoading && <span className="text-[11px] text-cooper-red">SAP doesn't have {lookedUp}.</span>}
              {sapPart.data && (
                <span className="text-[11px] text-fg-muted">
                  {sapPart.data.description} · {sapPart.data.listPrice === null ? "no list price in SAP" : `${formatMoney(sapPart.data.listPrice)} list`}
                </span>
              )}
            </div>
          )}
          {kind === "request" && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Priced request</span>
              <select value={requestId} onChange={(e) => setRequestId(e.target.value)} className="input" aria-label="Priced request">
                <option value="">Pick a priced request…</option>
                {pricedRequests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.requestNumber} — {r.altronicPartNumber} · {r.customerName} ({formatMoney(r.customerPrice ?? r.listPrice)})
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "free" && (
            <>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Part # (optional)</span>
                <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} className="input" />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Description</span>
                <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" aria-label="Description" />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Price each</span>
                <input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} className="input w-40" aria-label="Price each" />
              </label>
            </>
          )}

          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Quantity</span>
              <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="input w-28" aria-label="Quantity" />
            </label>
            {showsDiscount && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">{customer.name || "Customer"} discount %</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={discount}
                  onChange={(e) => {
                    setDiscount(e.target.value);
                    setDiscountTouched(true);
                  }}
                  className="input w-28"
                  aria-label="Customer discount"
                />
                <span className="text-[11px] text-fg-muted">
                  {groupDiscount.data !== null && groupDiscount.data !== undefined && !discountTouched
                    ? `group ${customer.customerGroup} for ${mpg}, from SAP`
                    : "blank = list price"}
                </span>
              </label>
            )}
          </div>

          {preview && (
            <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-sm">
              <span className="font-medium text-fg">{formatMoney(preview.unitPrice)}</span> each
              {preview.breaks.map((b) => (
                <span key={b.minQty} className="ml-3 text-fg-muted">
                  {b.minQty}+ {formatMoney(b.price)}
                </span>
              ))}
            </div>
          )}
          {error && <p role="alert" className="text-xs text-cooper-red">{error}</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
            Cancel
          </button>
          <button type="button" onClick={add} disabled={!preview} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50">
            Add line
          </button>
        </div>
      </div>
    </div>
  );
}
