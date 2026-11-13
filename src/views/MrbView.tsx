import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, ClipboardX, Download, Paperclip, Plus, SlidersHorizontal } from "lucide-react";
import { useMrbEntries } from "@/hooks/useMrb";
import type { MrbEntry } from "@/types/task";
import { MRB_DISPOSITIONS, MRB_WHERE_CAUSED } from "@/types/task";
import {
  compareMrbEntries,
  formatMoney,
  formatQuantity,
  isArchivedMrbEntry,
  mrbState,
  mrbYearOptions,
  needsDisposition,
} from "@/lib/mrbMapper";
import { MRB_FIELD_BY_KEY } from "@/lib/mrbFields";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { formatSpDate } from "@/lib/spDates";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SortableHeader } from "@/components/SortableTableHeader";
import { useSortableTable } from "@/hooks/useSortableTable";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { MrbFormModal } from "@/components/MrbFormModal";
import { MrbExportModal } from "@/components/MrbExportModal";
import { MrbArchiveChip, MrbDispositionChip } from "@/components/mrbAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// MRB — the Material Review Board register (Supply Chain).
//
// **The default view is "Needs disposition", and that is the whole point of
// the screen.** The list holds 2,960 rows of which only 97 are live, and of
// those 37 had no disposition recorded at discovery — material sitting in a
// bin that nobody has decided about. Opening on all 2,960 buries them.
//
// The tabs split the register three ways:
//
//   Needs disposition  live, and either blank or "To be Determined"
//   Decided            live, with a real disposition
//   Archive            retained history from the old Excel workbooks
//   All                everything
//
// **Archive is a separate tab, not a filter people have to know to apply**
// (Tim, 2026-09-21: the legacy rows are "just data retention from older excel
// files and not active items"). They are still fully searchable — the point
// of keeping them — but they are not work.
//
// What's RENDERED is capped (`INITIAL_ROWS`, with a "Show all"); the filters,
// the counts and the totals always run over everything.
// =============================================================================

const INITIAL_ROWS = 150;

type MrbTab = "needs" | "decided" | "archive" | "all";

const TABS: { id: MrbTab; label: string }[] = [
  { id: "needs", label: "Needs disposition" },
  { id: "decided", label: "Decided" },
  { id: "archive", label: "Archive" },
  { id: "all", label: "All" },
];

function inTab(entry: MrbEntry, tab: MrbTab): boolean {
  switch (tab) {
    case "needs":
      return needsDisposition(entry);
    case "decided":
      return mrbState(entry) === "decided";
    case "archive":
      return isArchivedMrbEntry(entry);
    case "all":
      return true;
  }
}

/**
 * Sortable columns, as DATA. See lib/tableSort.ts for the shared rules.
 *
 * Quantity and the two prices are real `number` columns, so they sort as
 * values — a text sort would put "10" before "9" on a register whose whole
 * job is adding money up.
 */
const MRB_COLUMNS: SortColumn<MrbEntry>[] = [
  { key: "sapNumber", label: "SAP Number", value: (e) => e.sapNumber },
  // `field_2`, whose SharePoint label is "Old Part Number" — see mrbFields.ts
  // for why it reads as Altronic Part Number everywhere in ARC. Set on every
  // live row, blank on most archive ones.
  {
    key: "oldPartNumber",
    label: MRB_FIELD_BY_KEY.oldPartNumber.label,
    value: (e) => e.oldPartNumber,
  },
  {
    key: "description",
    label: "Description",
    // Matches the cell's own fallback, so the filter menu offers exactly
    // what is on screen. Archive rows mostly have no description and lead
    // with the reason instead.
    value: (e) => e.description || e.reason,
    noFilter: true,
  },
  { key: "vendor", label: "Vendor", value: (e) => e.vendorName },
  {
    key: "quantity",
    label: "Qty",
    kind: "number",
    value: (e) => formatQuantity(e.quantity),
    sortValue: (e) => e.quantity,
  },
  {
    key: "pricePerIssue",
    label: "Cost",
    kind: "number",
    value: (e) => formatMoney(e.pricePerIssue),
    sortValue: (e) => e.pricePerIssue,
    noFilter: true,
  },
  { key: "whereCaused", label: "Where Caused", value: (e) => e.whereCaused },
  // BusinessIT#71. Yes / No, so the value menu offers exactly what the cell
  // shows, and a sort groups the panel department's entries together.
  { key: "panelDepartment", label: "Panel", value: (e) => panelLabel(e) },
  { key: "disposition", label: "Disposition", value: (e) => e.disposition },
  {
    key: "mrbDate",
    label: "MRB Date",
    kind: "date",
    value: (e) => dayLabel(e.mrbDate),
    sortValue: (e) => e.mrbDate,
  },
];

/** The Panel department flag as the list shows it. */
function panelLabel(entry: MrbEntry): "Yes" | "No" {
  return entry.panelDepartment ? "Yes" : "No";
}

/** `?panel=` — only the panel department's entries, or only everyone else's. */
const PANEL_FILTER_OPTIONS = [
  { value: "yes", label: "Panel department only" },
  { value: "no", label: "Not panel department" },
];

/**
 * Per-column classes, shared by the header and the cell so they can't
 * disagree about whether a column is showing.
 *
 * **The table fits the page without scrolling sideways** (Tim, 2026-11-11).
 * Three things do it:
 *  - Description takes whatever width is LEFT (`w-full` on the header,
 *    `max-w-0` on the cell) and truncates — it is the long free text, and
 *    the full value is in its tooltip and on the entry.
 *  - Vendor and Where Caused truncate at a fixed width, with a tooltip.
 *  - Below `xl` (1280px) the two columns least needed to pick a row —
 *    Altronic Part Number and Where Caused — are hidden. They are still on
 *    the phone card, the entry page and the export.
 * Padding is `px-3` rather than the header's default `px-4`.
 */
const COLUMN_CLASS: Record<string, string> = {
  sapNumber: "px-3",
  oldPartNumber: "hidden px-3 xl:table-cell",
  description: "w-full px-3",
  vendor: "px-3",
  quantity: "px-3",
  pricePerIssue: "px-3",
  whereCaused: "hidden px-3 xl:table-cell",
  panelDepartment: "px-3",
  disposition: "px-3",
  mrbDate: "px-3",
};

export function MrbView() {
  const navigate = useNavigate();
  const { data: entries = [], isLoading } = useMrbEntries();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const q = params.get("q") ?? "";
  const vendor = params.get("vendor") ?? "";
  const cause = params.get("cause") ?? "";
  const year = params.get("year") ?? "";
  const panelParam = params.get("panel") ?? "";
  // Anything other than yes / no in the URL is ignored, never a filter that
  // matches nothing.
  const panel = panelParam === "yes" || panelParam === "no" ? panelParam : "";
  const tab = (params.get("tab") as MrbTab) || "needs";

  // How many of the four filters are actually narrowing the list. Drives the
  // badge on the toggle, and forces the panel open so a filter can never be
  // both active and invisible — including one that arrived in the URL.
  const activeFilterCount = [q, vendor, cause, year, panel].filter(Boolean).length;
  const filtersOpen = filtersExpanded || activeFilterCount > 0;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const counts = useMemo(() => {
    const out = { needs: 0, decided: 0, archive: 0, all: entries.length };
    for (const entry of entries) {
      if (isArchivedMrbEntry(entry)) out.archive += 1;
      else if (needsDisposition(entry)) out.needs += 1;
      else out.decided += 1;
    }
    return out;
  }, [entries]);

  // Vendor options come from the data — there is no vendor list behind this
  // column, it is free text, and 276 distinct spellings are in there.
  const vendors = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of entries) if (entry.vendorName) seen.add(entry.vendorName);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const years = useMemo(() => mrbYearOptions(entries), [entries]);

  const filtered = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return entries.filter((entry) => {
      if (!inTab(entry, tab)) return false;
      if (vendor && entry.vendorName !== vendor) return false;
      if (cause && entry.whereCaused !== cause) return false;
      if (year && String(entry.mrbDate?.getUTCFullYear() ?? "") !== year) return false;
      if (panel && entry.panelDepartment !== (panel === "yes")) return false;
      return matchesSearch(entry, tokens);
    });
  }, [entries, q, vendor, cause, year, panel, tab]);

  // The money on screen, over everything the filters kept — not the capped
  // rows. A total that changes when you press "show all" is worthless.
  const totalCost = useMemo(
    () => filtered.reduce((sum, e) => sum + (e.pricePerIssue ?? 0), 0),
    [filtered],
  );

  const table = useSortableTable<MrbEntry>({
    rows: filtered,
    columns: MRB_COLUMNS,
    stableKey: (e) => e.id,
    initialKey: "mrbDate",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });

  // The cap is for the unfiltered case — once somebody has narrowed down, it
  // shouldn't keep hiding rows they went looking for.
  useEffect(() => {
    setShowAll(false);
  }, [q, vendor, cause, year, panel, tab]);

  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <ClipboardX className="h-5 w-5" />
        </span>
        {/* The min-width makes the buttons WRAP below on a phone rather than
            squeezing this text to one word per line (the Suppliers header
            lesson). */}
        <div className="min-w-[14rem] flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Material Review Board
          </h1>
          <p className="text-sm text-fg-muted">
            Nonconforming material — the part, why it was rejected, who caused
            it and what was decided to do with it.
          </p>
        </div>
        {/* For the meeting: a date window as a printable PDF or a workbook.
            It reads the whole register, not the tab or filters on screen. */}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setShowExport(true)}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg shadow-xs transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            New Entry
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setParam("tab", t.id === "needs" ? "" : t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
            <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">
              {counts[t.id].toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      {tab === "archive" && (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          Retained history imported from the old Excel workbooks. These are kept
          so they stay searchable — they are not live entries, and nothing here
          is waiting on a decision.
        </p>
      )}

      {/* Collapsed by default ON A PHONE only: four filter controls stacked
          above the list pushed the entries themselves off the screen. On
          desktop the row costs nothing and is always shown (`sm:hidden` on
          the toggle, `sm:grid` on the panel), so this is one piece of state
          rather than two behaviours.

          An ACTIVE filter always forces it open — see `filtersOpen`. A
          narrowed list whose reason is hidden behind a collapsed panel is
          the invisible-filter trap the EIR status pills already paid for. */}
      <button
        type="button"
        onClick={() => setFiltersExpanded((v) => !v)}
        aria-expanded={filtersOpen}
        aria-controls="mrb-filters"
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
        id="mrb-filters"
        role="search"
        aria-label="MRB filters"
        className={cn(
          "grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid sm:grid-cols-3 lg:grid-cols-5",
          filtersOpen ? "grid" : "hidden",
        )}
      >
        <Filter label="Search">
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="Part, reason, vendor, notes…"
          />
        </Filter>
        <Filter label="Vendor">
          <ChoiceSelect
            value={vendor}
            onChange={(v) => setParam("vendor", v)}
            options={vendors}
            emptyLabel="Any vendor"
            searchPlaceholder="Search vendors…"
          />
        </Filter>
        <Filter label="Where Caused">
          <ChoiceSelect
            value={cause}
            onChange={(v) => setParam("cause", v)}
            options={[...MRB_WHERE_CAUSED]}
            emptyLabel="Any"
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
        {/* A filter here as well as the column's own value menu: a phone has
            no column headers, and this one lives in the URL, so a report
            link can carry it. */}
        <Filter label="Panel department">
          <ChoiceSelect
            value={panel}
            onChange={(v) => setParam("panel", v)}
            options={PANEL_FILTER_OPTIONS}
            emptyLabel="Anyone"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          <span>
            {isLoading
              ? "Loading…"
              : `${filtered.length.toLocaleString()} entr${filtered.length === 1 ? "y" : "ies"}`}
            {!isLoading && totalCost > 0 && (
              <span className="ml-2 font-normal text-fg-muted">
                · {formatMoney(totalCost)} total
              </span>
            )}
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
          <LoadingTasks noun="the MRB register" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {tab === "needs" && !q && !vendor && !cause && !year && !panel
              ? "Nothing is waiting on a disposition. Switch to Decided or Archive to see the rest."
              : "No entries match these filters."}
          </div>
        ) : (
          <>
            {/* Two renderings of the SAME `shown` rows, split at `sm`
                (640px). Nine columns don't fit a phone even truncated, and a
                horizontally-scrolling table is miserable to use one-handed.
                The QcFormView / QcTimeTrackingView shape.

                NOTE FOR TESTS: jsdom has no CSS breakpoints, so BOTH render
                at once and every entry's text appears twice. Scope queries
                to the table, or use getAllBy*. */}
            <div className="divide-y divide-border sm:hidden">
              {shown.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onOpen={() => navigate(`/supply-chain/mrb/${entry.id}`)}
                />
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {MRB_COLUMNS.map((column) => (
                      <SortableHeader
                        key={column.key}
                        label={column.label}
                        className={COLUMN_CLASS[column.key]}
                        {...table.headerProps(column.key)}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((entry) => (
                    <Row
                      key={entry.id}
                      entry={entry}
                      onOpen={() => navigate(`/supply-chain/mrb/${entry.id}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showExport && <MrbExportModal entries={entries} onClose={() => setShowExport(false)} />}

      {showNew && (
        <MrbFormModal
          onClose={() => setShowNew(false)}
          onSaved={(id) => navigate(`/supply-chain/mrb/${id}`)}
        />
      )}
    </div>
  );
}

/**
 * One entry on a phone.
 *
 * A real `<button>`, not a `<div>` — there is no competing action inside it,
 * so the whole card is the one tap target (the QcFormView call; QC Time
 * Tracking's card can't do this because it carries its own delete icon).
 *
 * Leads with the two identifiers and the disposition, because that is what
 * the register is scanned for. Cost is shown as the ISSUE total: the per-unit
 * price is detail, and a phone card has no room for both.
 */
function EntryCard({ entry, onOpen }: { entry: MrbEntry; onOpen: () => void }) {
  const archived = isArchivedMrbEntry(entry);
  const rows: Array<[string, string]> = [
    [MRB_FIELD_BY_KEY.oldPartNumber.label, entry.oldPartNumber || "—"],
    ["Vendor", entry.vendorName || "—"],
    ["Qty", formatQuantity(entry.quantity)],
    ["Cost", formatMoney(entry.pricePerIssue)],
    ["Where Caused", entry.whereCaused || "—"],
    ["Panel department", panelLabel(entry)],
    ["MRB Date", formatSpDate(entry.mrbDate)],
  ];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-fg">
          {entry.sapNumber || `#${entry.id}`}
        </span>
        {archived && <MrbArchiveChip />}
        {entry.hasAttachments && (
          <Paperclip className="h-3 w-3 shrink-0 text-fg-muted" aria-label="Has attachments" />
        )}
        <MrbDispositionChip disposition={entry.disposition} archived={archived} />
      </div>

      {(entry.description || entry.reason) && (
        <p className="line-clamp-2 text-sm text-fg-muted">
          {entry.description || entry.reason}
        </p>
      )}

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

function Row({ entry, onOpen }: { entry: MrbEntry; onOpen: () => void }) {
  const archived = isArchivedMrbEntry(entry);
  const cell = (key: string, extra = "") =>
    cn("whitespace-nowrap py-2 text-fg-muted", COLUMN_CLASS[key], extra);
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
    >
      <td className={cell("sapNumber", "font-medium text-fg")}>
        <span className="inline-flex items-center gap-1.5">
          <Link
            to={`/supply-chain/mrb/${entry.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent hover:underline"
          >
            {entry.sapNumber || `#${entry.id}`}
          </Link>
          {archived && <MrbArchiveChip />}
          {entry.hasAttachments && (
            <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />
          )}
        </span>
      </td>
      <td className={cell("oldPartNumber")}>{entry.oldPartNumber || "—"}</td>
      {/* `max-w-0` + the header's `w-full`: this column takes the width the
          others leave, and truncates inside it. */}
      <td className={cell("description", "max-w-0 truncate")} title={entry.description || entry.reason}>
        {entry.description || entry.reason || "—"}
      </td>
      <td className={cell("vendor", "max-w-[11rem] truncate")} title={entry.vendorName}>
        {entry.vendorName || "—"}
      </td>
      <td className={cell("quantity", "tabular-nums")}>{formatQuantity(entry.quantity)}</td>
      <td className={cell("pricePerIssue", "tabular-nums")}>{formatMoney(entry.pricePerIssue)}</td>
      <td className={cell("whereCaused", "max-w-[9rem] truncate")} title={entry.whereCaused}>
        {entry.whereCaused || "—"}
      </td>
      <td className={cell("panelDepartment", entry.panelDepartment ? "font-medium text-fg" : "")}>
        {panelLabel(entry)}
      </td>
      <td className={cn("py-2", COLUMN_CLASS.disposition)}>
        <MrbDispositionChip disposition={entry.disposition} archived={archived} />
      </td>
      <td className={cell("mrbDate", "tabular-nums")}>{formatSpDate(entry.mrbDate)}</td>
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

export { MRB_DISPOSITIONS, compareMrbEntries };
