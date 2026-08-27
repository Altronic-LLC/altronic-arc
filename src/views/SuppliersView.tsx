import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ExternalLink, MessageSquare, Plus, Truck } from "lucide-react";
import { useSuppliers } from "@/hooks/useSuppliers";
import type { Supplier } from "@/types/task";
import { SUPPLIER_CORE_COMPETENCIES, SUPPLIER_STATUSES } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { SupplierFormModal } from "@/components/SupplierFormModal";
import { SupplierLogo } from "@/components/SupplierLogo";
import { cn } from "@/lib/cn";

// =============================================================================
// SRM Tool — Suppliers List. This is the anchor screen: open a supplier, see
// their contacts and open issues from there. Supplier Contacts and Supplier
// Issue Tracker have no top-level screens of their own for that reason (Ray,
// 2026-08-26: "Supplier list is the main source and everything is tied to it").
//
// 531 rows at discovery, so the row-cap pattern applies from the start.
// =============================================================================

const INITIAL_ROWS = 150;

/**
 * Cooper's supplier-onboarding tool — a separate SaaS product (Medius), not
 * part of ARC. A plain external link, opened in a new tab; there is no data
 * connection between the two yet. Ray, 2026-08-27: onboarding a supplier
 * onto SAP happens in Medius, so this is where someone starts that, from
 * the screen where they'd otherwise go looking for "add a new supplier."
 * A Power Automate flow (built and owned outside ARC) is the planned path
 * to eventually sync new Medius suppliers into this list automatically —
 * see the SRM Tool section in CLAUDE.md.
 */
const MEDIUS_SUPPLIER_DIRECTORY_URL = "https://app.medius.com/cooperservices/suppliers/directory";

export function SuppliersView() {
  const navigate = useNavigate();
  const { data: suppliers = [], isLoading } = useSuppliers();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const competency = params.get("competency") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setShowAll(false);
  }

  const filtered = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return suppliers.filter((s) => {
      if (status && s.status !== status) return false;
      if (competency && !s.coreCompetencies.includes(competency as Supplier["coreCompetencies"][number]))
        return false;
      return matchesSearch(s, tokens);
    });
  }, [suppliers, q, status, competency]);

  const shown = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      {/*
        The icon+title+description live in their OWN row, separate from the
        two action buttons, rather than all five as siblings of one
        `flex-wrap` row. Mixing a `flex-1` text block with `flex-wrap`
        button siblings squeezed the paragraph into a near-zero-width,
        one-word-per-line column on a phone — the row's wrap-point
        calculation was made across every child at once, and the buttons'
        combined width left the text block's calculated line share tiny
        before it dropped to its own line (Ray, 2026-08-27, screenshot on
        iOS). Two independent rows means each only ever has to fit its own
        content.
      */}
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
            <Truck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Suppliers</h1>
            <p className="text-sm text-fg-muted">
              The SRM tool — open a supplier to see their contacts and open issues.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <a
            href={MEDIUS_SUPPLIER_DIRECTORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
            title="Opens Medius in a new tab — sign-in there is separate from ARC"
          >
            <ExternalLink className="h-4 w-4" />
            Supplier Onboarding
          </a>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            New supplier
          </button>
        </div>
      </header>

      <div
        role="search"
        aria-label="Supplier filters"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3"
      >
        <Filter label="Search">
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="Company name, BP number…"
          />
        </Filter>
        <Filter label="Status">
          <ChoiceSelect
            value={status}
            onChange={(v) => setParam("status", v)}
            options={SUPPLIER_STATUSES}
            emptyLabel="Any status"
          />
        </Filter>
        <Filter label="Core Competency">
          <ChoiceSelect
            value={competency}
            onChange={(v) => setParam("competency", v)}
            options={SUPPLIER_CORE_COMPETENCIES}
            emptyLabel="Any competency"
            searchPlaceholder="Search competencies…"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          <span>
            {isLoading
              ? "Loading…"
              : `${filtered.length.toLocaleString()} supplier${filtered.length === 1 ? "" : "s"}`}
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
          <LoadingTasks noun="suppliers" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            No suppliers match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Supplier</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Core Competency</th>
                  <th className="px-4 py-2 font-semibold">Assigned Buyer</th>
                  <th className="px-4 py-2 font-semibold">Performance</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <Row key={s.id} supplier={s} onOpen={() => navigate(`/supply-chain/supplier/${s.id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <SupplierFormModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Row({ supplier, onOpen }: { supplier: Supplier; onOpen: () => void }) {
  return (
    <tr onClick={onOpen} className={cn("cursor-pointer border-t border-border transition-colors hover:bg-surface-2")}>
      <td className="max-w-[18rem] truncate px-4 py-2 font-medium text-fg" title={supplier.title}>
        <span className="inline-flex items-center gap-2">
          <SupplierLogo supplierId={supplier.id} logo={supplier.logo} className="h-6 w-6 shrink-0 p-0.5" />
          {supplier.title || `#${supplier.id}`}
          {supplier.comments.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted"
              title={`${supplier.comments.length} comment${supplier.comments.length === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" />
              {supplier.comments.length}
            </span>
          )}
        </span>
      </td>
      <td className="px-4 py-2 text-fg-muted">{supplier.status || "—"}</td>
      <td className="max-w-[14rem] truncate px-4 py-2 text-fg-muted">
        {supplier.coreCompetencies.join(", ") || "—"}
      </td>
      <td className="px-4 py-2 text-fg-muted">{supplier.assignedBuyer?.displayName || "—"}</td>
      <td className="px-4 py-2 text-fg-muted">
        {supplier.supplierPerformanceRate !== null ? `${supplier.supplierPerformanceRate}%` : "—"}
      </td>
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
