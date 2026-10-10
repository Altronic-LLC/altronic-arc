import { useMemo, useState } from "react";
import { Building2, Lock, Pencil, Plus } from "lucide-react";
import type { QuoteCustomer } from "@/types/quote";
import { useQuoteCustomers } from "@/hooks/useQuoteCustomers";
import { useMyQuoteAccess } from "@/hooks/useQuoteRoles";
import { accessQuotesGate, manageCustomersGate } from "@/lib/quoteRoles";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { useSortableTable } from "@/hooks/useSortableTable";
import type { SortColumn } from "@/lib/tableSort";
import { SortableHeader } from "@/components/SortableTableHeader";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SearchInput } from "@/components/SearchInput";
import { QuotesNav } from "@/components/QuotesNav";
import { QuoteCustomerFormModal } from "@/components/QuoteCustomerFormModal";
import { cn } from "@/lib/cn";

// =============================================================================
// Insourcing Quotes → Customers. The register every quote's customer is picked
// from, and where its CODE (the `COO` in `IQ-COO-0042-R1`) is set.
//
// Anyone with a quote role READS it — a quoter needs to see who exists before
// asking for a new one. Only a quote MANAGER adds or edits (`manageCustomersGate`);
// for everyone else the Add and Edit controls are simply absent, never dead.
//
// No delete: quotes point at these rows, so a customer is RETIRED (Active =
// No). Retired rows are hidden by default and one toggle away.
// =============================================================================

export const QUOTE_CUSTOMER_COLUMNS: SortColumn<QuoteCustomer>[] = [
  { key: "name", label: "Name", value: (c) => c.name, noFilter: true },
  { key: "code", label: "Code", value: (c) => c.code },
  { key: "customerNumber", label: "Customer #", value: (c) => c.customerNumber },
  { key: "active", label: "Active", value: (c) => (c.active ? "Yes" : "No") },
  { key: "note", label: "Note", value: (c) => c.note, noFilter: true },
];

export function QuoteCustomersView() {
  const access = useMyQuoteAccess();
  const gate = accessQuotesGate(access);

  if (!access.configured) {
    return (
      <Shell>
        <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 p-3 text-sm text-fg">
          <span className="font-semibold text-ajax-yellow">Insourcing Quotes isn't set up yet.</span> The
          Quote Roles list isn't configured (<code>VITE_SP_QUOTE_ROLES_LIST_ID</code>), so nobody holds a
          quote role. Run <code>scripts/create-quote-lists.ps1</code>, set the list ids and redeploy.
        </div>
      </Shell>
    );
  }
  if (gate.resolving) {
    return (
      <Shell>
        <LoadingTasks noun="quote customers" />
      </Shell>
    );
  }
  if (!gate.allowed) {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
          <Lock className="mx-auto h-8 w-8" />
          <p className="mt-3 font-medium text-fg">You don't have access to Insourcing Quotes.</p>
          <p className="mt-1">{gate.hint}</p>
        </div>
      </Shell>
    );
  }
  return <CustomersRegister canManage={manageCustomersGate(access).allowed} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <QuotesNav />
      {children}
    </div>
  );
}

function CustomersRegister({ canManage }: { canManage: boolean }) {
  const { data: customers = [], isLoading, error, refetch } = useQuoteCustomers();
  const listUnavailable = !!error && isPermissionDenied(error);
  const [q, setQ] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  // undefined = closed, null = create, a row = edit.
  const [editing, setEditing] = useState<QuoteCustomer | null | undefined>(undefined);

  const retiredCount = customers.filter((c) => !c.active).length;
  const filtered = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return customers.filter((c) => (showRetired || c.active) && matchesSearch(c, tokens));
  }, [customers, q, showRetired]);

  const table = useSortableTable<QuoteCustomer>({
    rows: filtered,
    columns: QUOTE_CUSTOMER_COLUMNS,
    stableKey: (c) => c.id,
    initialKey: "name",
  });

  return (
    <Shell>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Quote customers</h1>
            <p className="text-sm text-fg-muted">
              Who quotes are raised for, and the code each quote number carries.
              {!canManage && " Only a quote manager can add or edit a customer."}
            </p>
          </div>
        </div>
        {canManage && (
          <div>
            <button
              onClick={() => setEditing(null)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
            >
              <Plus className="h-4 w-4" />
              Add customer
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchInput value={q} onChange={setQ} placeholder="Name, code, customer number…" />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
            className="h-3.5 w-3.5 accent-accent"
          />
          Show retired{retiredCount > 0 ? ` (${retiredCount})` : ""}
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          {isLoading ? "Loading…" : `${table.rows.length} customer${table.rows.length === 1 ? "" : "s"}`}
        </div>

        {isLoading ? (
          <LoadingTasks noun="quote customers" />
        ) : listUnavailable ? (
          <div className="p-4">
            <ListAccessNotice list="Quote Customers" site="Altronic_PMO" onRetry={() => void refetch()} />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load quote customers.</p>
            <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : customers.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">No quote customers yet.</p>
            <p className="mt-1">
              {canManage ? 'Click "Add customer" to add the first.' : "A quote manager adds them."}
            </p>
          </div>
        ) : table.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">No customers match.</div>
        ) : (
          <>
            {/* Two renderings of the SAME rows, split at `sm`. jsdom has no
                breakpoints, so tests see both — use getAllBy*. */}
            <div className="divide-y divide-border sm:hidden">
              {table.rows.map((c) => (
                <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-semibold text-fg">
                        {c.code}
                      </span>
                      <span className="truncate font-medium text-fg">{c.name}</span>
                      {!c.active && <RetiredChip />}
                    </div>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-fg-muted">
                      <dt>Customer #</dt>
                      <dd className="font-mono">{c.customerNumber || "—"}</dd>
                      {c.note && (
                        <>
                          <dt>Note</dt>
                          <dd>{c.note}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                  {canManage && <EditButton customer={c} onEdit={() => setEditing(c)} />}
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {QUOTE_CUSTOMER_COLUMNS.map((column) => (
                      <SortableHeader key={column.key} label={column.label} {...table.headerProps(column.key)} />
                    ))}
                    {canManage && <th className="px-2 py-2" aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((c) => (
                    <tr key={c.id} className={cn("border-t border-border", !c.active && "opacity-70")}>
                      <td className="px-4 py-2 font-medium text-fg">{c.name}</td>
                      <td className="px-4 py-2 font-mono text-xs font-semibold text-fg">{c.code}</td>
                      <td className="px-4 py-2 font-mono text-xs text-fg-muted">{c.customerNumber || "—"}</td>
                      <td className="px-4 py-2 text-fg-muted">{c.active ? "Yes" : <RetiredChip />}</td>
                      <td className="max-w-[20rem] truncate px-4 py-2 text-fg-muted" title={c.note}>
                        {c.note || "—"}
                      </td>
                      {canManage && (
                        <td className="px-2 py-2 text-right">
                          <EditButton customer={c} onEdit={() => setEditing(c)} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {editing !== undefined && (
        <QuoteCustomerFormModal customer={editing} onClose={() => setEditing(undefined)} />
      )}
    </Shell>
  );
}

function RetiredChip() {
  return (
    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
      Retired
    </span>
  );
}

function EditButton({ customer, onEdit }: { customer: QuoteCustomer; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Edit ${customer.name}`}
      title="Edit customer"
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
    >
      <Pencil className="h-3 w-3" />
      Edit
    </button>
  );
}
