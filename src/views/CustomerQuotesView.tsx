import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import { CUSTOMER_QUOTES_CONFIGURED } from "@/api/config";
import { CUSTOMER_QUOTE_STATUSES, type CustomerQuote, type CustomerQuoteStatus, type SapCustomer } from "@/types/pricing";
import { useCreateCustomerQuote, useCustomerQuotes } from "@/hooks/useCustomerQuotes";
import { isLatestRevision, latestRevisions, quoteTotal } from "@/lib/customerQuotes";
import { formatMoney } from "@/lib/quoteMoney";
import { formatDisplayDate, toIsoDate } from "@/lib/dateInput";
import { tokenizeQuery } from "@/lib/itemSearch";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import type { SortColumn } from "@/lib/tableSort";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableHeader } from "@/components/SortableTableHeader";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SearchInput } from "@/components/SearchInput";
import { SapCustomerPicker } from "@/components/SapCustomerPicker";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";
import { PricingHeader, PricingManagerGate, PricingPage } from "@/components/pricingAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// Customer Quotes — SQ-YYYY-####-R# (/sales/pricing/quotes). Managers and
// admins only. One row per quote by default — its latest revision; earlier
// revisions on request, chipped so one is never mistaken for the current one.
// =============================================================================

const ALL = "All";

const STATUS_TONE: Record<CustomerQuoteStatus, string> = {
  Draft: "bg-surface-2 text-fg-muted border-border",
  Sent: "bg-superior-blue/10 text-superior-blue border-superior-blue/30",
  Won: "bg-cooper-green/10 text-cooper-green border-cooper-green/30",
  Lost: "bg-cooper-red/10 text-cooper-red border-cooper-red/30",
  Expired: "bg-ajax-yellow/15 text-fg border-ajax-yellow/40",
};

export function CustomerQuoteStatusChip({ status }: { status: CustomerQuoteStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[status])}>
      {status}
    </span>
  );
}

const created = (q: CustomerQuote) => (q.createdAt ? toIsoDate(new Date(q.createdAt)) : "");

export const CUSTOMER_QUOTE_COLUMNS: SortColumn<CustomerQuote>[] = [
  { key: "number", label: "Quote #", value: (q) => q.quoteNumber },
  { key: "customer", label: "Customer", value: (q) => q.customer.name },
  { key: "status", label: "Status", value: (q) => q.status },
  { key: "lines", label: "Lines", kind: "number", value: (q) => String(q.lines.length), sortValue: (q) => q.lines.length },
  {
    key: "total",
    label: "Total",
    kind: "number",
    value: (q) => formatMoney(quoteTotal(q.lines)),
    sortValue: (q) => quoteTotal(q.lines),
    noFilter: true,
  },
  { key: "created", label: "Created", kind: "date", value: created, sortValue: (q) => (q.createdAt ? new Date(q.createdAt) : null) },
];

export function CustomerQuotesView() {
  return (
    <PricingManagerGate configured={CUSTOMER_QUOTES_CONFIGURED} listName="Customer Quotes" envVar="VITE_SP_CUSTOMER_QUOTES_LIST_ID">
      {() => <QuotesList />}
    </PricingManagerGate>
  );
}

function QuotesList() {
  const navigate = useNavigate();
  const { data: quotes = [], isLoading, error, refetch } = useCustomerQuotes();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const q = params.get("q") ?? "";
  const status = params.get("status") || ALL;
  const showEarlier = params.get("revs") === "all";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const searched = useMemo(() => {
    const base = showEarlier ? quotes : latestRevisions(quotes);
    const tokens = tokenizeQuery(q);
    return base.filter((x) => {
      const hay = `${x.quoteNumber} ${x.customer.name} ${x.customer.soldTo} ${x.lines.map((l) => l.partNumber).join(" ")}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [quotes, q, showEarlier]);
  const filtered = status === ALL ? searched : searched.filter((x) => x.status === status);

  const table = useSortableTable<CustomerQuote>({
    rows: filtered,
    columns: CUSTOMER_QUOTE_COLUMNS,
    stableKey: (x) => x.id,
    initialKey: "number",
    initialDirection: "desc",
  });
  const open = (id: number) => navigate(`/sales/pricing/quote/${id}`);

  return (
    <PricingPage wide>
      <PricingHeader
        title="Customer Quotes"
        subtitle="Quotes built from new-product worksheets, SAP parts, priced requests and extra lines — with the customer PDF."
        actions={
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" /> New quote
          </button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
          {[ALL, ...CUSTOMER_QUOTE_STATUSES].map((pill) => (
            <button
              key={pill}
              onClick={() => setParam("status", pill === ALL ? "" : pill)}
              aria-pressed={status === pill}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                status === pill ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
              )}
            >
              {pill}
              <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">
                {pill === ALL ? searched.length : searched.filter((x) => x.status === pill).length}
              </span>
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={showEarlier} onChange={(e) => setParam("revs", e.target.checked ? "all" : "")} className="h-3.5 w-3.5 accent-cooper-red" />
          Show earlier revisions
        </label>
        <div className="min-w-[220px] flex-1">
          <SearchInput value={q} onChange={(v) => setParam("q", v)} placeholder="Quote #, customer, part…" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <LoadingTasks noun="customer quotes" />
        ) : error && isPermissionDenied(error) ? (
          <div className="p-4">
            <ListAccessNotice list="Customer Quotes" site="ALTRONICSALESTEAM" onRetry={() => void refetch()} />
          </div>
        ) : error ? (
          <p className="px-4 py-10 text-center text-sm text-fg-muted">Couldn't load the quotes.</p>
        ) : quotes.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-fg-muted">No customer quotes yet — start one with New quote.</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-fg-muted">No quotes match.</p>
        ) : (
          <>
            <div className="divide-y divide-border sm:hidden">
              {table.rows.map((x) => (
                <button key={x.id} type="button" onClick={() => open(x.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface-2">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-fg">{x.quoteNumber}</span>
                    <span className="ml-auto">
                      <CustomerQuoteStatusChip status={x.status} />
                    </span>
                  </span>
                  <span className="text-sm text-fg">{x.customer.name || "No customer"}</span>
                  <span className="text-xs text-fg-muted">{formatMoney(quoteTotal(x.lines))}</span>
                </button>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {CUSTOMER_QUOTE_COLUMNS.map((c) => (
                      <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((x) => (
                    <tr key={x.id} onClick={() => open(x.id)} className="cursor-pointer border-t border-border hover:bg-surface-2">
                      <td className="whitespace-nowrap px-4 py-2 font-medium">
                        <Link to={`/sales/pricing/quote/${x.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent hover:underline">
                          {x.quoteNumber}
                        </Link>
                        {!isLatestRevision(x, quotes) && (
                          <span className="ml-2 rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">
                            Superseded
                          </span>
                        )}
                      </td>
                      <td className="max-w-[18rem] truncate px-4 py-2">{x.customer.name || "—"}</td>
                      <td className="px-4 py-2">
                        <CustomerQuoteStatusChip status={x.status} />
                      </td>
                      <td className="px-4 py-2 tabular-nums text-fg-muted">{x.lines.length}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatMoney(quoteTotal(x.lines))}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{formatDisplayDate(created(x)) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {showNew && <NewQuoteModal onClose={() => setShowNew(false)} onSaved={open} />}
    </PricingPage>
  );
}

function NewQuoteModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const create = useCreateCustomerQuote();
  const pending = create.isPending;
  const [customer, setCustomer] = useState<SapCustomer | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [validity, setValidity] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const overlay = useOverlayDismiss(onClose, pending);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const days = Number(validity);
    if (!customer?.name.trim()) return setError("Pick the customer.");
    if (!Number.isInteger(days) || days < 1) return setError("Validity must be a whole number of days.");
    setError(null);
    try {
      const created = await create.mutateAsync({
        validityDays: days,
        customer: { ...customer, contactName: contactName.trim(), contactEmail: contactEmail.trim() },
        lines: [],
        notes: "",
      });
      onClose();
      onSaved(created.id);
    } catch {
      // The hook toasts the reason.
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" {...overlay}>
      <div role="dialog" aria-modal="true" aria-label="New customer quote" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">New customer quote</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Customer <span className="text-cooper-red">*</span>
            </span>
            <SapCustomerPicker value={customer} onChange={setCustomer} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Contact name</span>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="input" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Contact email</span>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="input" />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Valid for (days)</span>
            <input type="number" min={1} value={validity} onChange={(e) => setValidity(e.target.value)} className="input w-32" />
          </label>
          {error && (
            <div role="alert" className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-2 py-1.5 text-xs text-cooper-red">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create quote
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
