import { useEffect, useMemo, useState } from "react";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileText, MessageSquare, Paperclip, Plus, SlidersHorizontal } from "lucide-react";
import { QUOTES_CONFIGURED } from "@/api/config";
import { listQuoteAssemblies } from "@/api/quoteAssemblies";
import { listQuoteItems } from "@/api/quoteItems";
import { QUOTE_ASSEMBLIES_KEY, QUOTE_ITEMS_KEY, useQuotes } from "@/hooks/useQuotes";
import { useQuoteCustomers } from "@/hooks/useQuoteCustomers";
import { useMyQuoteAccess, type MyQuoteAccess } from "@/hooks/useQuoteRoles";
import { QUOTE_STATUSES, type Quote, type QuoteCustomer, type QuoteStatus } from "@/types/quote";
import { isLatestRevision, latestRevisions } from "@/lib/quoteNumber";
import { priceQuote } from "@/lib/quotePricing";
import { quoteExpiryDate } from "@/lib/quotePdfModel";
import { accessQuotesGate, createQuoteGate, seeCostGate } from "@/lib/quoteRoles";
import { formatDisplayDate, toIsoDate } from "@/lib/dateInput";
import { tokenizeQuery } from "@/lib/itemSearch";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import type { SortColumn } from "@/lib/tableSort";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableHeader } from "@/components/SortableTableHeader";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { QuotesNav } from "@/components/QuotesNav";
import { QuoteFormModal } from "@/components/QuoteFormModal";
import { cn } from "@/lib/cn";

// =============================================================================
// Insourcing Quotes — the list (/sales/quotes).
//
// One row per quote BASE by default — its latest rev (`latestRevisions`; the
// latest is derived, never stored). "Show earlier revisions" lists every rev,
// and a superseded one is chipped so it is never mistaken for the current one.
//
// The Total is the SELL price (one of each assembly at its base tier), so
// every role sees it. GM % is cost-derived and appears ONLY for someone
// `seeCostGate` allows — hidden, not masked. That is UI-only: Graph still
// returns the cost columns, and SharePoint list permissions are the boundary.
//
// What's RENDERED is capped (INITIAL_ROWS + Show all); filters, counts and
// sorting always run over everything.
// =============================================================================

const INITIAL_ROWS = 150;
const ALL = "All";

// The shared quote formatters live in lib/quoteMoney.ts; re-exported here
// for the screens that already import them from this view.
export { formatMoney, formatPct, formatUnitCost } from "@/lib/quoteMoney";

/** A quote's expiry as `yyyy-mm-dd` — created date + validity days. "" when unknown. */
export function quoteExpiry(quote: Pick<Quote, "createdAt" | "validityDays">): string {
  if (!quote.createdAt) return "";
  const created = new Date(quote.createdAt);
  if (Number.isNaN(created.getTime())) return "";
  return quoteExpiryDate(toIsoDate(created), quote.validityDays);
}

const STATUS_TONE: Record<QuoteStatus, string> = {
  Draft: "bg-surface-2 text-fg-muted border-border",
  Sent: "bg-superior-blue/10 text-superior-blue border-superior-blue/30",
  Won: "bg-cooper-green/10 text-cooper-green border-cooper-green/30",
  Lost: "bg-cooper-red/10 text-cooper-red border-cooper-red/30",
  Expired: "bg-ajax-yellow/15 text-fg border-ajax-yellow/40",
};

export function QuoteStatusChip({ status }: { status: QuoteStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        STATUS_TONE[status] ?? STATUS_TONE.Draft,
      )}
    >
      {status}
    </span>
  );
}

/**
 * The three things every quote screen says before it shows anything: the
 * lists aren't set up, we're still finding out who you are, or you have no
 * quote role. Never a blank page. `children` is a function so the screen's
 * own queries only run once access is settled.
 */
export function QuoteAccessGate({ children }: { children: (access: MyQuoteAccess) => React.ReactNode }) {
  const access = useMyQuoteAccess();
  const gate = accessQuotesGate(access);

  if (!QUOTES_CONFIGURED || !access.configured) {
    return (
      <QuotePage>
        <div className="rounded-xl border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          <p className="font-medium">Insourcing Quotes isn't set up yet.</p>
          <p className="mt-1 text-fg-muted">
            The five SharePoint list ids need to be set as repository variables, then redeployed:{" "}
            <span className="font-mono text-xs">
              VITE_SP_QUOTES_LIST_ID, VITE_SP_QUOTE_ASSEMBLIES_LIST_ID, VITE_SP_QUOTE_ITEMS_LIST_ID,
              VITE_SP_QUOTE_CUSTOMERS_LIST_ID, VITE_SP_QUOTE_ROLES_LIST_ID
            </span>
            .
          </p>
        </div>
      </QuotePage>
    );
  }
  if (gate.resolving) {
    return (
      <QuotePage>
        <LoadingTasks noun="your quote access" />
      </QuotePage>
    );
  }
  if (!gate.allowed) {
    return (
      <QuotePage>
        <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm">
          {access.failed ? (
            <p className="font-medium text-fg">{gate.hint}</p>
          ) : (
            <p className="font-medium text-fg">
              You don't have access to Insourcing Quotes — ask a quote manager to add you.
            </p>
          )}
        </div>
      </QuotePage>
    );
  }
  return <>{children(access)}</>;
}

function QuotePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <QuotesNav />
      {children}
    </div>
  );
}

export function QuotesView() {
  return <QuoteAccessGate>{(access) => <QuotesList access={access} />}</QuoteAccessGate>;
}

/** One list row — the quote plus everything derived for display. */
interface QuoteRow {
  id: number;
  quote: Quote;
  customer: QuoteCustomer | null;
  assemblyCount: number;
  total: number | null;
  gmPct: number | null;
  expires: string;
  latest: boolean;
}

function buildColumns(canSeeCost: boolean): SortColumn<QuoteRow>[] {
  const cols: SortColumn<QuoteRow>[] = [
    { key: "quoteNumber", label: "Quote #", value: (r) => r.quote.quoteNumber },
    { key: "customer", label: "Customer", value: (r) => r.customer?.name ?? "" },
    { key: "status", label: "Status", value: (r) => r.quote.status },
    {
      key: "assemblies",
      label: "Assemblies",
      kind: "number",
      value: (r) => String(r.assemblyCount),
      sortValue: (r) => r.assemblyCount,
    },
    {
      key: "total",
      label: "Total",
      kind: "number",
      value: (r) => (r.total === null ? "" : formatMoney(r.total)),
      sortValue: (r) => r.total,
      noFilter: true,
    },
  ];
  if (canSeeCost) {
    cols.push({
      key: "gm",
      label: "GM %",
      kind: "number",
      value: (r) => (r.gmPct === null ? "" : formatPct(r.gmPct)),
      sortValue: (r) => r.gmPct,
      noFilter: true,
    });
  }
  cols.push(
    {
      key: "created",
      label: "Created",
      kind: "date",
      value: (r) => (r.quote.createdAt ? toIsoDate(new Date(r.quote.createdAt)) : ""),
      sortValue: (r) => (r.quote.createdAt ? new Date(r.quote.createdAt) : null),
    },
    {
      key: "expires",
      label: "Expires",
      kind: "date",
      value: (r) => r.expires,
      sortValue: (r) => (r.expires ? new Date(`${r.expires}T12:00:00`) : null),
    },
  );
  return cols;
}

function QuotesList({ access }: { access: MyQuoteAccess }) {
  const navigate = useNavigate();
  const canSeeCost = seeCostGate(access).allowed;
  const createGate = createQuoteGate(access);

  const { data: quotes = [], isLoading, error, refetch } = useQuotes();
  const { data: customers = [] } = useQuoteCustomers();
  const { data: assemblies = [] } = useQuery({
    queryKey: QUOTE_ASSEMBLIES_KEY,
    queryFn: listQuoteAssemblies,
    staleTime: 60_000,
  });
  const { data: items = [] } = useQuery({
    queryKey: QUOTE_ITEMS_KEY,
    queryFn: listQuoteItems,
    staleTime: 60_000,
  });
  const listUnavailable = !!error && isPermissionDenied(error);

  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const q = params.get("q") ?? "";
  const customerFilter = params.get("customer") ?? "";
  const status = params.get("status") || ALL;
  const showEarlier = params.get("revs") === "all";

  const activeFilterCount = [q, customerFilter].filter(Boolean).length;
  const filtersOpen = filtersExpanded || activeFilterCount > 0;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const rows = useMemo<QuoteRow[]>(() => {
    const base = showEarlier ? quotes : latestRevisions(quotes);
    return base.map((quote) => {
      const own = assemblies.filter((a) => a.quoteId === quote.id);
      const pricing = priceQuote(own, items);
      return {
        id: quote.id,
        quote,
        customer: quote.customerId === null ? null : (customerById.get(quote.customerId) ?? null),
        assemblyCount: own.length,
        total: pricing.quoteTotal,
        gmPct: pricing.quoteGmPct,
        expires: quoteExpiry(quote),
        latest: isLatestRevision(quote, quotes),
      };
    });
  }, [quotes, assemblies, items, customerById, showEarlier]);

  const customerOptions = useMemo(
    () =>
      [...customers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
    [customers],
  );

  // Everything the OTHER axes keep — the pills count over this.
  const byOtherAxes = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return rows.filter((r) => {
      if (customerFilter && String(r.quote.customerId ?? "") !== customerFilter) return false;
      if (tokens.length === 0) return true;
      const hay = [
        r.quote.quoteNumber,
        r.customer?.name ?? "",
        r.customer?.code ?? "",
        r.quote.contactName,
        r.quote.contactEmail,
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [rows, q, customerFilter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { [ALL]: byOtherAxes.length };
    for (const s of QUOTE_STATUSES) out[s] = 0;
    for (const r of byOtherAxes) out[r.quote.status] = (out[r.quote.status] ?? 0) + 1;
    return out;
  }, [byOtherAxes]);

  const filtered = useMemo(
    () => (status === ALL ? byOtherAxes : byOtherAxes.filter((r) => r.quote.status === status)),
    [byOtherAxes, status],
  );

  const columns = useMemo(() => buildColumns(canSeeCost), [canSeeCost]);
  const table = useSortableTable<QuoteRow>({
    rows: filtered,
    columns,
    stableKey: (r) => r.id,
    initialKey: "quoteNumber",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });

  useEffect(() => {
    setShowAll(false);
  }, [q, customerFilter, status, showEarlier]);

  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);
  const pills = [ALL, ...QUOTE_STATUSES];
  const open = (id: number) => navigate(`/sales/quotes/${id}`);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <QuotesNav />
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Insourcing Quotes</h1>
          <p className="text-sm text-fg-muted">
            Quotes for insourced builds — costing, quantity breaks and the customer PDF.
          </p>
        </div>
        {createGate.allowed && (
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            New quote
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
          {pills.map((pill) => (
            <button
              key={pill}
              onClick={() => setParam("status", pill === ALL ? "" : pill)}
              aria-pressed={status === pill}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === pill ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {pill}
              <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">
                {counts[pill] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={showEarlier}
            onChange={(e) => setParam("revs", e.target.checked ? "all" : "")}
            className="h-3.5 w-3.5 accent-cooper-red"
          />
          Show earlier revisions
        </label>
      </div>

      <button
        type="button"
        onClick={() => setFiltersExpanded((v) => !v)}
        aria-expanded={filtersOpen}
        aria-controls="quote-filters"
        className="inline-flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-fg sm:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-fg-muted" />
          Search and filters
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold tabular-nums text-white">
              {activeFilterCount}
            </span>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-fg-muted transition-transform", filtersOpen && "rotate-180")} />
      </button>

      <div
        id="quote-filters"
        role="search"
        aria-label="Quote filters"
        className={cn(
          "grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid sm:grid-cols-2",
          filtersOpen ? "grid" : "hidden",
        )}
      >
        <Filter label="Search">
          <SearchInput value={q} onChange={(v) => setParam("q", v)} placeholder="Quote #, customer, contact…" />
        </Filter>
        <Filter label="Customer">
          <ChoiceSelect
            value={customerFilter}
            onChange={(v) => setParam("customer", v)}
            options={customerOptions}
            emptyLabel="Any customer"
            searchPlaceholder="Search customers…"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          <span>
            {isLoading ? "Loading…" : `${filtered.length.toLocaleString()} quote${filtered.length === 1 ? "" : "s"}`}
          </span>
          {!isLoading && shown.length < table.rows.length && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Showing {shown.length.toLocaleString()} — show all
            </button>
          )}
        </div>

        {isLoading ? (
          <LoadingTasks noun="quotes" />
        ) : listUnavailable ? (
          <div className="p-4">
            <ListAccessNotice list="Quotes" site="Altronic_PMO" onRetry={() => void refetch()} />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load quotes.</p>
            <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : quotes.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">No quotes yet.</p>
            {createGate.allowed && <p className="mt-1">Raise the first one with New quote.</p>}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">No quotes match these filters.</div>
        ) : (
          <>
            {/* Two renderings of the SAME `shown` rows, split at `sm`. jsdom
                renders both at once — tests use getAllBy*. */}
            <div className="divide-y divide-border sm:hidden">
              {shown.map((row) => (
                <QuoteCard key={row.id} row={row} canSeeCost={canSeeCost} onOpen={() => open(row.id)} />
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {columns.map((column) => (
                      <SortableHeader key={column.key} label={column.label} {...table.headerProps(column.key)} />
                    ))}
                    <th className="px-2 py-2" aria-label="Attachments" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <Row key={row.id} row={row} canSeeCost={canSeeCost} onOpen={() => open(row.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNew && (
        <QuoteFormModal onClose={() => setShowNew(false)} onSaved={(id) => navigate(`/sales/quotes/${id}`)} />
      )}
    </div>
  );
}

function SupersededChip({ row }: { row: QuoteRow }) {
  if (row.latest) return null;
  return (
    <span className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">
      Superseded
    </span>
  );
}

function QuoteCard({ row, canSeeCost, onOpen }: { row: QuoteRow; canSeeCost: boolean; onOpen: () => void }) {
  const lines: Array<[string, string]> = [
    ["Assemblies", String(row.assemblyCount)],
    ["Total", formatMoney(row.total)],
    ...(canSeeCost ? ([["GM %", formatPct(row.gmPct)]] as Array<[string, string]>) : []),
    ["Expires", formatDisplayDate(row.expires) ?? "—"],
  ];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg">{row.quote.quoteNumber}</span>
        <SupersededChip row={row} />
        {row.quote.hasAttachments && <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />}
        <span className="ml-auto">
          <QuoteStatusChip status={row.quote.status} />
        </span>
      </div>
      <p className="truncate text-sm text-fg">{row.customer?.name ?? "No customer"}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {lines.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="truncate text-fg-muted">{label}</dt>
            <dd className="truncate text-right text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </button>
  );
}

function Row({ row, canSeeCost, onOpen }: { row: QuoteRow; canSeeCost: boolean; onOpen: () => void }) {
  const { quote } = row;
  return (
    <tr onClick={onOpen} className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2">
      <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">
        <span className="inline-flex items-center gap-1.5">
          <Link
            to={`/sales/quotes/${quote.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent hover:underline"
          >
            {quote.quoteNumber}
          </Link>
          <SupersededChip row={row} />
          {quote.comments.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted"
              title={`${quote.comments.length} comment${quote.comments.length === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" />
              {quote.comments.length}
            </span>
          )}
        </span>
      </td>
      <td className="max-w-[18rem] truncate px-4 py-2 text-fg">{row.customer?.name ?? "—"}</td>
      <td className="px-4 py-2">
        <QuoteStatusChip status={quote.status} />
      </td>
      <td className="px-4 py-2 tabular-nums text-fg-muted">{row.assemblyCount}</td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg">{formatMoney(row.total)}</td>
      {canSeeCost && <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{formatPct(row.gmPct)}</td>}
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {quote.createdAt ? (formatDisplayDate(toIsoDate(new Date(quote.createdAt))) ?? "—") : "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{formatDisplayDate(row.expires) ?? "—"}</td>
      <td className="px-2 py-2">
        {quote.hasAttachments && <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />}
      </td>
    </tr>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
