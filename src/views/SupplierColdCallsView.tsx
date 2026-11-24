import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Building2, ExternalLink, PhoneCall, Plus } from "lucide-react";
import { useSupplierColdCalls } from "@/hooks/useSupplierColdCalls";
import { useSortableTable } from "@/hooks/useSortableTable";
import { useIsPhone } from "@/hooks/useIsPhone";
import { SUPPLIER_COLD_CALLS_CONFIGURED } from "@/api/config";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SearchInput } from "@/components/SearchInput";
import { SortableHeader } from "@/components/SortableTableHeader";
import { PhoneSortBar } from "@/components/PhoneSortBar";
import { SupplierColdCallFormModal } from "@/components/SupplierColdCallFormModal";
import { supplierColdCallMatches, websiteHref } from "@/lib/supplierColdCalls";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { tokenizeQuery } from "@/lib/itemSearch";
import type { SortColumn } from "@/lib/tableSort";
import type { SupplierColdCall } from "@/types/supplierColdCall";

// =============================================================================
// SRM Tool — Supplier Cold Call Log (BusinessIT#79, Katie Fleming via feature
// request #52). Companies we don't buy from today — name, website, commodity,
// who we spoke to, notes — so somebody needing a new source can look here
// first. Anyone signed in adds, edits and removes an entry; a row opens the
// same form to edit it, since every field fits on one screen.
// =============================================================================

const INITIAL_ROWS = 150;

function contactLabel(c: SupplierColdCall): string {
  return c.contactName || c.contactEmail || c.contactPhone;
}

const COLUMNS: SortColumn<SupplierColdCall>[] = [
  { key: "company", label: "Company", value: (c) => c.company, noFilter: true },
  { key: "commodity", label: "Commodity", value: (c) => c.commodity },
  { key: "contact", label: "Contact", value: contactLabel, noFilter: true },
  { key: "website", label: "Website", value: (c) => c.website, noFilter: true },
  { key: "notes", label: "Notes", value: (c) => c.notes, noFilter: true },
  { key: "addedBy", label: "Added by", value: (c) => c.createdBy?.displayName ?? "" },
  {
    key: "added",
    label: "Added",
    kind: "date",
    value: (c) => c.createdAt.toLocaleDateString(),
    sortValue: (c) => c.createdAt.getTime(),
    noFilter: true,
  },
];

export default function SupplierColdCallsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: entries = [], isLoading, error, refetch } = useSupplierColdCalls();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SupplierColdCall | null>(null);
  const [showAll, setShowAll] = useState(false);
  const isPhone = useIsPhone();

  const query = searchParams.get("q") ?? "";

  const searched = useMemo(() => {
    const tokens = tokenizeQuery(query);
    return entries.filter((c) => supplierColdCallMatches(c, tokens));
  }, [entries, query]);

  const table = useSortableTable<SupplierColdCall>({
    rows: searched,
    columns: COLUMNS,
    stableKey: (c) => c.id,
    initialKey: "company",
    onChange: () => setShowAll(false),
  });

  useEffect(() => setShowAll(false), [query]);
  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <PhoneCall className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Cold Call Log</h1>
            <p className="text-sm text-fg-muted">
              Suppliers we don't do business with yet — somewhere to look when a new source is needed.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/supply-chain/suppliers"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
          >
            <Building2 className="h-4 w-4" />
            Suppliers
          </Link>
          {SUPPLIER_COLD_CALLS_CONFIGURED && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90"
            >
              <Plus className="h-4 w-4" />
              New entry
            </button>
          )}
        </div>
      </header>

      {!SUPPLIER_COLD_CALLS_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/50 bg-ajax-yellow/10 p-4 text-sm text-fg">
          The Cold Call Log isn't set up yet. An admin creates its SharePoint list with{" "}
          <code>scripts/create-supplier-cold-call-list.ps1</code> and sets{" "}
          <code>VITE_SP_SUPPLIER_COLD_CALLS_LIST_ID</code>.
        </div>
      ) : (
        <>
          <label className="flex max-w-xl flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Search</span>
            <SearchInput
              value={query}
              onChange={(q) => {
                const sp = new URLSearchParams(searchParams);
                if (q) sp.set("q", q);
                else sp.delete("q");
                setSearchParams(sp, { replace: true });
              }}
              placeholder="Company, commodity, contact, notes…"
            />
          </label>

          {isLoading ? (
            <LoadingTasks noun="the cold call log" />
          ) : error && isPermissionDenied(error) ? (
            <ListAccessNotice list="Supplier Cold Call Log" site="Altronic_PMO" onRetry={() => void refetch()} />
          ) : error ? (
            <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
              Couldn't load the Cold Call Log: {(error as Error).message}{" "}
              <button type="button" onClick={() => void refetch()} className="font-semibold underline">
                Try again
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
              Nothing on the log yet. Press New entry to add the first supplier.
            </div>
          ) : table.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
              No entries match.
              {table.hasFilters && (
                <button type="button" onClick={table.clearFilters} className="ml-1 text-accent hover:underline">
                  Clear column filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="text-xs text-fg-muted">
                Showing {shown.length} of {table.rows.length} {table.rows.length === 1 ? "entry" : "entries"}
              </div>
              {isPhone ? (
                <div className="flex flex-col gap-2">
                  <PhoneSortBar columns={COLUMNS} table={table} />
                  {shown.map((c) => (
                    <ColdCallCard key={c.id} entry={c} onOpen={() => setEditing(c)} />
                  ))}
                </div>
              ) : (
                <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-2 text-left">
                        {COLUMNS.map((col) => (
                          <SortableHeader key={col.key} label={col.label} {...table.headerProps(col.key)} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((c) => (
                        <Row key={c.id} entry={c} onOpen={() => setEditing(c)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!showAll && table.rows.length > INITIAL_ROWS && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="self-start text-sm font-medium text-accent hover:underline"
                >
                  Show all {table.rows.length}
                </button>
              )}
            </>
          )}
        </>
      )}

      {adding && <SupplierColdCallFormModal onClose={() => setAdding(false)} />}
      {editing && <SupplierColdCallFormModal entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** The website as a link that opens in a new tab, or the text as typed when it isn't one. */
function Website({ value }: { value: string }) {
  if (!value) return <span>—</span>;
  const href = websiteHref(value);
  if (!href) return <span>{value}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex max-w-full items-center gap-1 text-accent hover:underline"
    >
      <span className="truncate">{value.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

function Row({ entry, onOpen }: { entry: SupplierColdCall; onOpen: () => void }) {
  // The first of name / email / phone leads (the sort value); the rest sit under it.
  const [, ...extra] = [entry.contactName, entry.contactEmail, entry.contactPhone].filter(Boolean);
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-border align-top last:border-0 hover:bg-surface-2/60"
    >
      <td className="px-3 py-2 font-medium">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="text-left text-fg hover:text-accent hover:underline"
        >
          {entry.company}
        </button>
      </td>
      <td className="px-3 py-2 text-fg-muted">{entry.commodity || "—"}</td>
      <td className="px-3 py-2 text-fg-muted">
        <div className="whitespace-nowrap">{contactLabel(entry) || "—"}</div>
        {extra.map((line) => (
          <div key={line} className="whitespace-nowrap text-[11px]">
            {line}
          </div>
        ))}
      </td>
      <td className="max-w-[14rem] px-3 py-2 text-fg-muted">
        <Website value={entry.website} />
      </td>
      <td className="w-full max-w-0 px-3 py-2 text-fg-muted">
        <span className="block truncate" title={entry.notes}>
          {entry.notes || "—"}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{entry.createdBy?.displayName ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-fg-muted">
        {entry.createdAt.toLocaleDateString()}
      </td>
    </tr>
  );
}

function ColdCallCard({ entry, onOpen }: { entry: SupplierColdCall; onOpen: () => void }) {
  const contact = [entry.contactName, entry.contactPhone, entry.contactEmail].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <button type="button" onClick={onOpen} className="text-left font-semibold text-fg hover:text-accent">
        {entry.company}
      </button>
      {entry.commodity && <div className="text-sm text-fg">{entry.commodity}</div>}
      {contact && <div className="text-xs text-fg-muted">{contact}</div>}
      {entry.website && (
        <div className="text-xs">
          <Website value={entry.website} />
        </div>
      )}
      {entry.notes && <p className="line-clamp-3 whitespace-pre-wrap text-xs text-fg-muted">{entry.notes}</p>}
    </div>
  );
}
