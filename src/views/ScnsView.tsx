import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  FolderOpen,
  Megaphone,
  MessageSquare,
  Paperclip,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useScns } from "@/hooks/useScns";
import type { Scn } from "@/types/task";
import { SCN_CATEGORIES, SCN_STATUSES } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { useHiddenRowCount } from "@/hooks/useListAccess";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SortableHeader } from "@/components/SortableTableHeader";
import { useSortableTable } from "@/hooks/useSortableTable";
import { peopleLabel, type SortColumn } from "@/lib/tableSort";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { ScnFormModal } from "@/components/ScnFormModal";
import {
  ScnApprovalChip,
  ScnCategoryChip,
  ScnStatusChip,
  isOpenScn,
} from "@/components/scnAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// SCNs — Supply Chain Notices (obsolescence, phase-outs, EECRs).
//
// **Open is the default view.** 128 of the 142 live rows are CLOSED — history
// worth keeping and searching, but not work — and opening on all of them
// buries the handful that are. The pills switch it, and like every other
// filter the choice is in the URL so a view can be shared.
//
// What's RENDERED is capped (`INITIAL_ROWS`, with a "Show all"); the filters
// and every count always run over everything.
// =============================================================================

const INITIAL_ROWS = 150;

/** `status=` in the URL: absent = Open, "All", or one SCN Status value. */
const OPEN = "Open";
const ALL = "All";

function inStatus(scn: Scn, status: string): boolean {
  if (status === OPEN) return isOpenScn(scn.status);
  if (status === ALL) return true;
  return scn.status === status;
}

/**
 * Sortable columns, as DATA. See lib/tableSort.ts for the shared rules.
 *
 * Every `value` matches what its cell shows, so the filter menu offers
 * exactly what is on screen. Product is free text that rarely repeats, so it
 * sorts but doesn't offer a 140-option menu; the search box covers it.
 */
const SCN_COLUMNS: SortColumn<Scn>[] = [
  { key: "scnNumber", label: "SCN#", value: (s) => s.scnNumber },
  { key: "product", label: "Product", value: (s) => s.product, noFilter: true },
  { key: "category", label: "Category", value: (s) => s.category },
  { key: "status", label: "Status", value: (s) => s.status },
  { key: "approvalStatus", label: "Approval", value: (s) => s.approvalStatus },
  { key: "assignedTo", label: "Assigned to", value: (s) => peopleLabel(s.assignedTo) },
  { key: "owner", label: "Owner", value: (s) => peopleLabel(s.owner) },
  { key: "year", label: "Year", value: (s) => s.year },
];

export function ScnsView() {
  const navigate = useNavigate();
  const { data: scns = [], isLoading, error, refetch } = useScns();
  // A failed read must never render as "no SCNs" — a refusal gets the access
  // notice, anything else says it couldn't load, and the real empty state is
  // reserved for a read that SUCCEEDED and came back empty.
  const listUnavailable = !!error && isPermissionDenied(error);
  const hiddenRows = useHiddenRowCount("/supply-chain/scns");

  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const year = params.get("year") ?? "";
  const status = params.get("status") || OPEN;

  // Drives the badge on the phone toggle, and forces the panel open so a
  // filter can never be both active and invisible — including one that
  // arrived in the URL (the MrbView arrangement).
  const activeFilterCount = [q, category, year].filter(Boolean).length;
  const filtersOpen = filtersExpanded || activeFilterCount > 0;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  // Category and Year options come from the data — a Category no row holds
  // is still offered (the column's own choices), a year only when seen.
  const categories = useMemo(() => {
    const seen = new Set<string>(SCN_CATEGORIES);
    for (const s of scns) if (s.category) seen.add(s.category);
    return [...seen];
  }, [scns]);

  const years = useMemo(() => {
    const seen = new Set<string>();
    for (const s of scns) if (s.year) seen.add(s.year);
    return [...seen].sort((a, b) => b.localeCompare(a));
  }, [scns]);

  // Everything the OTHER axes keep — the pills count over this, so a status
  // pill's number says how many of the search results are in that state.
  const byOtherAxes = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return scns.filter((s) => {
      if (category && s.category !== category) return false;
      if (year && s.year !== year) return false;
      return matchesSearch(s, tokens);
    });
  }, [scns, q, category, year]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { [OPEN]: 0, [ALL]: byOtherAxes.length };
    for (const st of SCN_STATUSES) out[st] = 0;
    for (const s of byOtherAxes) {
      if (isOpenScn(s.status)) out[OPEN] += 1;
      if (s.status in out) out[s.status] += 1;
    }
    return out;
  }, [byOtherAxes]);

  const filtered = useMemo(
    () => byOtherAxes.filter((s) => inStatus(s, status)),
    [byOtherAxes, status],
  );

  const table = useSortableTable<Scn>({
    rows: filtered,
    columns: SCN_COLUMNS,
    stableKey: (s) => s.id,
    // Newest SCN# first — the number is chronological by construction.
    initialKey: "scnNumber",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });

  // The cap is for the unfiltered case — once somebody has narrowed down, it
  // shouldn't keep hiding rows they went looking for.
  useEffect(() => {
    setShowAll(false);
  }, [q, category, year, status]);

  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);
  const pills = [OPEN, ALL, ...SCN_STATUSES];

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
          <Megaphone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">SCNs</h1>
          <p className="text-sm text-fg-muted">
            Supply Chain Notices — obsolescence, phase-outs and EECRs, from the
            first notice to the final disposition.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/supply-chain/scns/documents"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
          >
            <FolderOpen className="h-4 w-4" />
            Documents
          </Link>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            New SCN
          </button>
        </div>
      </header>

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
            <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">
              {counts[pill] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Collapsed by default ON A PHONE only (`sm:hidden` toggle, `sm:grid`
          panel); an active filter forces it open — see `filtersOpen`. */}
      <button
        type="button"
        onClick={() => setFiltersExpanded((v) => !v)}
        aria-expanded={filtersOpen}
        aria-controls="scn-filters"
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
        <ChevronDown
          className={cn("h-4 w-4 text-fg-muted transition-transform", filtersOpen && "rotate-180")}
        />
      </button>

      <div
        id="scn-filters"
        role="search"
        aria-label="SCN filters"
        className={cn(
          "grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid sm:grid-cols-3",
          filtersOpen ? "grid" : "hidden",
        )}
      >
        <Filter label="Search">
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="SCN#, product, part number, customer, notes…"
          />
        </Filter>
        <Filter label="Category">
          <ChoiceSelect
            value={category}
            onChange={(v) => setParam("category", v)}
            options={categories}
            emptyLabel="Any category"
          />
        </Filter>
        <Filter label="Year">
          <ChoiceSelect
            value={year}
            onChange={(v) => setParam("year", v)}
            options={years}
            emptyLabel="Any year"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          <span>
            {isLoading
              ? "Loading…"
              : `${filtered.length.toLocaleString()} SCN${filtered.length === 1 ? "" : "s"}`}
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
          <LoadingTasks noun="SCNs" />
        ) : listUnavailable ? (
          <div className="p-4">
            <ListAccessNotice
              list="SCN Dashboard"
              site="ALTRONICSALESTEAM/SCN"
              onRetry={() => void refetch()}
            />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load SCNs.</p>
            <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : hiddenRows !== null ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">
              This list has {hiddenRows.toLocaleString()} records, and none of them are
              visible to your account.
            </p>
            <p className="mx-auto mt-1 max-w-md">
              SharePoint is hiding the rows rather than the list itself — that's
              item-level permissions. Ask an admin for access to the items on the{" "}
              <span className="font-mono text-xs">ALTRONICSALESTEAM/SCN</span> SCN
              Dashboard list.
            </p>
          </div>
        ) : scns.length === 0 ? (
          // The read SUCCEEDED and came back with nothing.
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">No SCNs yet.</p>
            <p className="mt-1">Raise the first one with New SCN.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {status === OPEN && activeFilterCount === 0
              ? "Nothing open. Switch to All to see closed and cancelled SCNs."
              : "No SCNs match these filters."}
          </div>
        ) : (
          <>
            {/* Two renderings of the SAME `shown` rows, split at `sm` (640px).
                Eight columns don't fit a phone. NOTE FOR TESTS: jsdom has no
                CSS breakpoints, so BOTH render at once — use getAllBy*. */}
            <div className="divide-y divide-border sm:hidden">
              {shown.map((scn) => (
                <ScnCard key={scn.id} scn={scn} onOpen={() => navigate(`/supply-chain/scn/${scn.id}`)} />
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {SCN_COLUMNS.map((column) => (
                      <SortableHeader
                        key={column.key}
                        label={column.label}
                        {...table.headerProps(column.key)}
                      />
                    ))}
                    <th className="px-2 py-2" aria-label="Attachments" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((scn) => (
                    <Row key={scn.id} scn={scn} onOpen={() => navigate(`/supply-chain/scn/${scn.id}`)} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNew && (
        <ScnFormModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => navigate(`/supply-chain/scn/${id}`)}
        />
      )}
    </div>
  );
}

/** One SCN on a phone — a real `<button>`, the whole card is the tap target. */
function ScnCard({ scn, onOpen }: { scn: Scn; onOpen: () => void }) {
  const rows: Array<[string, string]> = [
    ["Assigned to", peopleLabel(scn.assignedTo) || "—"],
    ["Owner", peopleLabel(scn.owner) || "—"],
    ["Year", scn.year || "—"],
  ];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg">{scn.scnNumber || `#${scn.id}`}</span>
        <ScnCategoryChip category={scn.category} />
        {scn.hasAttachments && (
          <Paperclip className="h-3 w-3 shrink-0 text-fg-muted" aria-label="Has attachments" />
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <ScnApprovalChip approvalStatus={scn.approvalStatus} />
          <ScnStatusChip status={scn.status} />
        </span>
      </div>
      <p className="truncate text-sm text-fg">{scn.product || "—"}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="truncate text-fg-muted">{label}</dt>
            <dd className="truncate text-right text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </button>
  );
}

function Row({ scn, onOpen }: { scn: Scn; onOpen: () => void }) {
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
    >
      <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">
        <span className="inline-flex items-center gap-1.5">
          <Link
            to={`/supply-chain/scn/${scn.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent hover:underline"
          >
            {scn.scnNumber || `#${scn.id}`}
          </Link>
          {scn.comments.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted"
              title={`${scn.comments.length} comment${scn.comments.length === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" />
              {scn.comments.length}
            </span>
          )}
        </span>
      </td>
      <td className="max-w-[20rem] truncate px-4 py-2 text-fg" title={scn.product}>
        {scn.product || "—"}
      </td>
      <td className="px-4 py-2">
        <ScnCategoryChip category={scn.category} />
      </td>
      <td className="px-4 py-2">
        <ScnStatusChip status={scn.status} />
      </td>
      <td className="px-4 py-2">
        <ScnApprovalChip approvalStatus={scn.approvalStatus} />
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {peopleLabel(scn.assignedTo) || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{peopleLabel(scn.owner) || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{scn.year || "—"}</td>
      <td className="px-2 py-2">
        {scn.hasAttachments && (
          <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />
        )}
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
