import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MessageSquare, Paperclip, Plus } from "lucide-react";
import { PRICING_REQUEST_STATUSES, OPEN_PRICING_STATUSES, type PricingRequest } from "@/types/pricing";
import { usePricingRequests } from "@/hooks/usePricingRequests";
import type { MyPricingAccess } from "@/hooks/usePricingRoles";
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
import { PricingRequestFormModal } from "@/components/PricingRequestFormModal";
import {
  PricingAccessGate,
  PricingHeader,
  PricingPage,
  PricingStatusChip,
} from "@/components/pricingAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// Sales Pricing — every request (/sales/pricing). Ray, 2026-10-13: "the
// initial screen should display all requests".
//
// It opens on OPEN requests (Awaiting SAP, Submitted, In Review) — the work —
// with Priced, Cancelled and All a pill away; the pill counts are over what
// the search keeps. Sortable, filterable headers like every list in ARC.
// What's RENDERED is capped; search, counts and sorting run over everything.
// =============================================================================

const INITIAL_ROWS = 150;
const OPEN = "Open";
const ALL = "All";

function createdDate(r: PricingRequest): string {
  return r.createdAt ? toIsoDate(new Date(r.createdAt)) : "";
}

export const PRICING_REQUEST_COLUMNS: SortColumn<PricingRequest>[] = [
  { key: "number", label: "Request #", value: (r) => r.requestNumber },
  { key: "part", label: "Altronic #", value: (r) => r.altronicPartNumber },
  { key: "description", label: "Description", value: (r) => r.description, noFilter: true },
  { key: "customer", label: "Customer", value: (r) => r.customerName },
  { key: "requestedBy", label: "Requested by", value: (r) => r.requestedBy?.displayName ?? "" },
  { key: "status", label: "Status", value: (r) => r.status },
  {
    key: "listPrice",
    label: "List price",
    kind: "number",
    value: (r) => (r.listPrice === null ? "" : formatMoney(r.listPrice)),
    sortValue: (r) => r.listPrice,
    noFilter: true,
  },
  {
    key: "created",
    label: "Raised",
    kind: "date",
    value: createdDate,
    sortValue: (r) => (r.createdAt ? new Date(r.createdAt) : null),
  },
];

export function PricingRequestsView() {
  return <PricingAccessGate>{(access) => <RequestsList access={access} />}</PricingAccessGate>;
}

function RequestsList({ access: _access }: { access: MyPricingAccess }) {
  const navigate = useNavigate();
  const { data: requests = [], isLoading, error, refetch } = usePricingRequests();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const q = params.get("q") ?? "";
  const status = params.get("status") || OPEN;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const searched = useMemo(() => {
    const tokens = tokenizeQuery(q);
    if (tokens.length === 0) return requests;
    return requests.filter((r) => {
      const hay = [
        r.requestNumber,
        r.altronicPartNumber,
        r.sapPartNumber,
        r.description,
        r.requestedDescription,
        r.customerName,
        r.customerSoldTo,
        r.requestedBy?.displayName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [requests, q]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { [OPEN]: 0, [ALL]: searched.length };
    for (const s of PRICING_REQUEST_STATUSES) out[s] = 0;
    for (const r of searched) {
      out[r.status] = (out[r.status] ?? 0) + 1;
      if (OPEN_PRICING_STATUSES.includes(r.status)) out[OPEN] += 1;
    }
    return out;
  }, [searched]);

  const filtered = useMemo(() => {
    if (status === ALL) return searched;
    if (status === OPEN) return searched.filter((r) => OPEN_PRICING_STATUSES.includes(r.status));
    return searched.filter((r) => r.status === status);
  }, [searched, status]);

  const table = useSortableTable<PricingRequest>({
    rows: filtered,
    columns: PRICING_REQUEST_COLUMNS,
    stableKey: (r) => r.id,
    initialKey: "created",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });

  useEffect(() => setShowAll(false), [q, status]);

  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);
  const pills = [OPEN, ...PRICING_REQUEST_STATUSES, ALL];
  const open = (id: number) => navigate(`/sales/pricing/request/${id}`);

  return (
    <PricingPage wide>
      <PricingHeader
        title="Sales Pricing"
        subtitle="Pricing requests for Contact Factory items — raised by Sales, priced by the pricing managers."
        actions={
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" /> New request
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
          {pills.map((pill) => (
            <button
              key={pill}
              onClick={() => setParam("status", pill === OPEN ? "" : pill)}
              aria-pressed={status === pill}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === pill ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {pill}
              <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">{counts[pill] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="min-w-[220px] flex-1">
          <SearchInput value={q} onChange={(v) => setParam("q", v)} placeholder="Request #, part, customer, requester…" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          <span>{isLoading ? "Loading…" : `${filtered.length.toLocaleString()} request${filtered.length === 1 ? "" : "s"}`}</span>
          {!isLoading && shown.length < table.rows.length && (
            <button onClick={() => setShowAll(true)} className="text-xs font-medium text-accent underline-offset-2 hover:underline">
              Showing {shown.length.toLocaleString()} — show all
            </button>
          )}
        </div>

        {isLoading ? (
          <LoadingTasks noun="pricing requests" />
        ) : error && isPermissionDenied(error) ? (
          <div className="p-4">
            <ListAccessNotice list="Pricing Requests" site="ALTRONICSALESTEAM" onRetry={() => void refetch()} />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load pricing requests.</p>
            <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : requests.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">No pricing requests yet.</p>
            <p className="mt-1">Raise the first one with New request.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">No requests match.</div>
        ) : (
          <>
            {/* Two renderings of the SAME rows, split at `sm`. jsdom renders both — tests use getAllBy*. */}
            <div className="divide-y divide-border sm:hidden">
              {shown.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => open(r.id)}
                  className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-surface-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg">{r.requestNumber}</span>
                    <span className="font-mono text-xs text-fg-muted">{r.altronicPartNumber}</span>
                    <span className="ml-auto">
                      <PricingStatusChip status={r.status} />
                    </span>
                  </div>
                  <p className="truncate text-sm text-fg">{r.description || "—"}</p>
                  <p className="truncate text-xs text-fg-muted">
                    {r.customerName || "No customer"} · {r.requestedBy?.displayName ?? "—"}
                    {r.listPrice !== null && ` · ${formatMoney(r.listPrice)}`}
                  </p>
                </button>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {PRICING_REQUEST_COLUMNS.map((c) => (
                      <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                    ))}
                    <th className="px-2 py-2" aria-label="Attachments" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} onClick={() => open(r.id)} className="cursor-pointer border-t border-border hover:bg-surface-2">
                      <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">
                        <span className="inline-flex items-center gap-1.5">
                          <Link
                            to={`/sales/pricing/request/${r.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-accent hover:underline"
                          >
                            {r.requestNumber}
                          </Link>
                          {r.comments.length > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted">
                              <MessageSquare className="h-3 w-3" />
                              {r.comments.length}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-fg">{r.altronicPartNumber}</td>
                      <td className="max-w-[20rem] truncate px-4 py-2 text-fg">{r.description}</td>
                      <td className="max-w-[14rem] truncate px-4 py-2 text-fg">{r.customerName || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{r.requestedBy?.displayName ?? "—"}</td>
                      <td className="px-4 py-2">
                        <PricingStatusChip status={r.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg">{formatMoney(r.listPrice)}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
                        {formatDisplayDate(createdDate(r)) ?? "—"}
                      </td>
                      <td className="px-2 py-2">
                        {r.hasAttachments && <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNew && <PricingRequestFormModal onClose={() => setShowNew(false)} onSaved={open} />}
    </PricingPage>
  );
}
