import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Building2, MessageSquare, Plus } from "lucide-react";
import { useCustomerNotes } from "@/hooks/useCustomerNotes";
import type { CustomerNote } from "@/types/task";
import { CUSTOMER_GROUPS } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { CustomerNoteFormModal } from "@/components/CustomerNoteFormModal";
import { cn } from "@/lib/cn";

// =============================================================================
// CRM Tool — Customer Notes list. This is the anchor screen: open a customer,
// see their contacts, special pricing and capacity commitments from there.
// Customer Contacts, Special Pricing and Capacity have no top-level screens of
// their own for that reason (Ray, 2026-08-26: "start with Customer Notes,
// then be able to see that customer's contacts").
//
// ~100 rows today — well under the row-cap threshold, but the pattern is
// applied anyway so this doesn't need revisiting once the list grows.
// =============================================================================

const INITIAL_ROWS = 150;

export function CustomerNotesView() {
  const navigate = useNavigate();
  const { data: notes = [], isLoading } = useCustomerNotes();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const q = params.get("q") ?? "";
  const group = params.get("group") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setShowAll(false);
  }

  const filtered = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return notes.filter((n) => {
      if (group && n.group !== group) return false;
      return matchesSearch(n, tokens);
    });
  }, [notes, q, group]);

  const shown = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <Building2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Customers</h1>
          <p className="text-sm text-fg-muted">
            The CRM tool — open a customer to see their contacts, special
            pricing and capacity commitments.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New customer
        </button>
      </header>

      <div
        role="search"
        aria-label="Customer filters"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2"
      >
        <Filter label="Search">
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="Customer name, SAP number…"
          />
        </Filter>
        <Filter label="Group">
          <ChoiceSelect
            value={group}
            onChange={(v) => setParam("group", v)}
            options={CUSTOMER_GROUPS}
            emptyLabel="Any group"
            searchPlaceholder="Search groups…"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          <span>
            {isLoading
              ? "Loading…"
              : `${filtered.length.toLocaleString()} customer${filtered.length === 1 ? "" : "s"}`}
          </span>
          {!isLoading && shown.length < filtered.length && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Showing {shown.length.toLocaleString()} — show all
            </button>
          )}
        </div>

        {isLoading ? (
          <LoadingTasks noun="customers" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            No customers match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Customer</th>
                  <th className="px-4 py-2 font-semibold">SAP #</th>
                  <th className="px-4 py-2 font-semibold">Group</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">CSR</th>
                  <th className="px-4 py-2 font-semibold">KAM</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((note) => (
                  <Row
                    key={note.id}
                    note={note}
                    onOpen={() => navigate(`/sales/customers/${note.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <CustomerNoteFormModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Row({ note, onOpen }: { note: CustomerNote; onOpen: () => void }) {
  return (
    <tr onClick={onOpen} className={cn("cursor-pointer border-t border-border transition-colors hover:bg-surface-2")}>
      <td className="max-w-[16rem] truncate px-4 py-2 font-medium text-fg" title={note.customerName}>
        <span className="inline-flex items-center gap-1.5">
          {note.customerName || `#${note.id}`}
          {note.comments.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted"
              title={`${note.comments.length} comment${note.comments.length === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" />
              {note.comments.length}
            </span>
          )}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{note.sapCustomerNumber || "—"}</td>
      <td className="px-4 py-2 text-fg-muted">{note.group || "—"}</td>
      <td className="px-4 py-2 text-fg-muted">{note.customerTypes.join(", ") || "—"}</td>
      <td className="max-w-[10rem] truncate px-4 py-2 text-fg-muted">
        {note.csr.map((p) => p.displayName).join(", ") || "—"}
      </td>
      <td className="max-w-[10rem] truncate px-4 py-2 text-fg-muted">{note.kam?.displayName || "—"}</td>
    </tr>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
