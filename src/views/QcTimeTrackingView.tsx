import { useMemo, useState } from "react";
import { PauseCircle, Pencil, Plus, Timer, Trash2 } from "lucide-react";
import { useDeleteQcTimeEntry, useQcTimeEntries } from "@/hooks/useQcTimeTracking";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import type { QcTimeEntry } from "@/types/task";
import { formatSpDate } from "@/lib/spDates";
import { cn } from "@/lib/cn";
import {
  applyQcTimeColumnFilters,
  compareQcTimeBy,
  qcTimeColumnOptions,
  QC_TIME_SORT_COLUMNS,
  type QcTimeSortKey,
} from "@/lib/qcTimeSort";
import { SearchInput } from "@/components/SearchInput";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SortableHeader, useTableSort } from "@/components/SortableTableHeader";
import { QcTimeEntryFormModal } from "@/components/QcTimeEntryFormModal";

// =============================================================================
// QC Time Tracking — Panels' log of hours QC spends on a project.
//
// A plain table, not a detail-page + list pair like Visit Reports: this list
// has no comments, no watchers, no attachments — every field fits on one row,
// so clicking a row opens the SAME form modal in edit mode rather than
// navigating to a separate page. Any signed-in user can add or edit an entry.
//
// Three things were added 2026-09-16, all from the floor (Ray):
//
//  - **Sorting and per-column filters**, the same chrome as the Panel QC
//    Issue Tracker (`components/SortableTableHeader.tsx`). Sorting by Hours
//    is the point — "easily spot panels with increased time" — and the
//    awkward part is that `hoursRaw` is TEXT: see `lib/qcTimeSort.ts`.
//  - **A hold flag**, replacing the highlight the old Excel sheet had. Amber
//    row plus a labelled chip, so the signal survives a mono print and
//    colour-blindness — colour is never the only carrier.
//  - **Delete, ADMIN-ONLY**, for a genuine duplicate (two techs, one panel).
//    The gate is in the hook's mutationFn too, not just on the button.
// =============================================================================

const INITIAL_ROWS = 300;

function matches(entry: QcTimeEntry, query: string): boolean {
  if (!query) return true;
  const haystack = [
    entry.project,
    entry.sapNo,
    entry.serialNo,
    entry.performedByRaw,
    entry.performedBy.map((p) => p.displayName).join(" "),
    entry.effortType ?? "",
    entry.notes,
    // So "missing parts" finds the stalled panels by typing, not just by
    // the filter menu.
    entry.holdReason,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export function QcTimeTrackingView() {
  const { data: entries = [], isLoading } = useQcTimeEntries();
  const { isAdmin } = useAdminAccess();
  const remove = useDeleteQcTimeEntry();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<QcTimeEntry | null>(null);
  // Newest work first by default, as before — the sort is an opt-in, so the
  // screen people already know opens the way it always has.
  const { sortKey, sortDirection, toggleSort } = useTableSort<QcTimeSortKey>(
    "dateStarted",
    "desc",
  );
  const [columnFilters, setColumnFilters] = useState<
    Partial<Record<QcTimeSortKey, Set<string>>>
  >({});
  // "Show me what's stuck" — the queue a tech works from. Separate from the
  // On Hold column filter because it is the one question worth a single click.
  const [holdOnly, setHoldOnly] = useState(false);

  // Options come from the WHOLE loaded list, not the filtered one, so
  // unchecking a value never removes it from a different column's menu.
  const columnOptions = useMemo(() => {
    const out = {} as Record<QcTimeSortKey, string[]>;
    for (const { key } of QC_TIME_SORT_COLUMNS) out[key] = qcTimeColumnOptions(entries, key);
    return out;
  }, [entries]);

  const holdCount = useMemo(() => entries.filter((e) => e.onHold).length, [entries]);

  const filtered = useMemo(() => {
    const searched = entries.filter((e) => matches(e, query));
    const held = holdOnly ? searched.filter((e) => e.onHold) : searched;
    return applyQcTimeColumnFilters(held, columnFilters).sort((a, b) =>
      compareQcTimeBy(a, b, sortKey, sortDirection),
    );
  }, [entries, query, holdOnly, columnFilters, sortKey, sortDirection]);
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  function setColumnFilter(key: QcTimeSortKey, next: Set<string> | undefined) {
    setColumnFilters((prev) => {
      const out = { ...prev };
      if (next === undefined) delete out[key];
      else out[key] = next;
      return out;
    });
    setShowAll(false);
  }

  function handleDelete(entry: QcTimeEntry) {
    // Named in the prompt, and the reason spelled out: this is for a
    // duplicate, not for tidying history.
    const ok = window.confirm(
      `Delete this QC time entry?

${entry.project || "(no project)"}` +
        `${entry.serialNo ? ` · ${entry.serialNo}` : ""}

` +
        "Use this for a duplicate entry. Anything else should be corrected " +
        "with an edit — a delete can't be undone.",
    );
    if (ok) remove.mutate(entry.id);
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <Timer className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            QC Time Tracking
          </h1>
          <p className="text-sm text-fg-muted">
            Hours QC spent on each panel — who did the work, and when.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New Entry
        </button>
      </header>

      <SearchInput
        value={query}
        onChange={(v) => {
          setQuery(v);
          setShowAll(false);
        }}
        placeholder="Search project, SAP#, serial#, who did it, notes…"
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <h2 className="text-sm font-medium text-fg">
            {isLoading ? "Loading…" : `${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}`}
            {!isLoading && filtered.length !== entries.length && (
              <span className="ml-1 text-fg-muted">of {entries.length}</span>
            )}
          </h2>
          {/*
            The "needs revisiting" queue, one click. Hidden entirely when
            nothing is on hold — an always-present "0 on hold" button is
            noise, and its absence is itself the answer.
          */}
          {!isLoading && holdCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setHoldOnly((v) => !v);
                setShowAll(false);
              }}
              aria-pressed={holdOnly}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                holdOnly
                  ? "border-ajax-yellow/50 bg-ajax-yellow/20 text-ajax-yellow-fg"
                  : "border-border bg-surface text-fg-muted hover:text-fg",
              )}
            >
              <PauseCircle className="h-3.5 w-3.5" />
              {holdCount} on hold
            </button>
          )}
        </div>

        {!showAll && filtered.length > INITIAL_ROWS && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-ajax-yellow/10 px-4 py-2 text-xs text-fg">
            <span>
              Showing <strong>{INITIAL_ROWS}</strong> of <strong>{filtered.length}</strong> — the
              rest are loaded, just not drawn yet.
            </span>
            <button
              onClick={() => setShowAll(true)}
              className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-fg transition-colors hover:bg-surface-2"
            >
              Show all {filtered.length}
            </button>
          </div>
        )}

        {isLoading ? (
          <LoadingTasks noun="QC time entries" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {query
              ? "No entries match that search."
              : "No entries yet. Click \"New Entry\" to log the first."}
          </div>
        ) : (
          <>
            {/* Phone: a card per entry — the table's eight columns don't fit a
                narrow screen even truncated, so most of them would render as
                a wall of dashes. Every field that has a value gets its own
                labelled row instead. */}
            <div className="divide-y divide-border sm:hidden">
              {visible.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={() => setEditing(entry)}
                  canDelete={isAdmin}
                  onDelete={() => handleDelete(entry)}
                />
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {QC_TIME_SORT_COLUMNS.map(({ key, label }) => (
                      <SortableHeader
                        key={key}
                        columnKey={key}
                        label={label}
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                        onToggleSort={toggleSort}
                        options={columnOptions[key]}
                        selected={columnFilters[key]}
                        onFilterChange={(next) => setColumnFilter(key, next)}
                      />
                    ))}
                    <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => (
                    <Row
                      key={entry.id}
                      entry={entry}
                      onEdit={() => setEditing(entry)}
                      canDelete={isAdmin}
                      onDelete={() => handleDelete(entry)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNew && <QcTimeEntryFormModal onClose={() => setShowNew(false)} />}
      {editing && <QcTimeEntryFormModal entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function performedByLabel(entry: QcTimeEntry): string {
  return entry.performedBy.length > 0
    ? entry.performedBy.map((p) => p.displayName).join(", ")
    : entry.performedByRaw || "—";
}

/**
 * The on-hold marker.
 *
 * Amber, AND a word. The old Excel sheet highlighted these rows, but colour
 * alone doesn't survive a mono print or reach a colour-blind reader — so the
 * reason (or "On hold" when none was given) is spelled out in the chip. Same
 * rule as every other status signal in ARC.
 */
function HoldChip({ entry }: { entry: QcTimeEntry }) {
  if (!entry.onHold) return <span className="text-fg-muted">—</span>;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-ajax-yellow/50 bg-ajax-yellow/15 px-2 py-0.5 text-xs font-medium text-ajax-yellow-fg"
      title={entry.holdReason ? `On hold — ${entry.holdReason}` : "On hold"}
    >
      <PauseCircle className="h-3 w-3 shrink-0" />
      {entry.holdReason || "On hold"}
    </span>
  );
}

function Row({
  entry,
  onEdit,
  canDelete,
  onDelete,
}: {
  entry: QcTimeEntry;
  onEdit: () => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <tr
      onClick={onEdit}
      className={cn(
        "cursor-pointer border-t border-border transition-colors",
        // The row tint is the at-a-glance signal the Excel sheet had; the
        // chip carries the meaning.
        entry.onHold ? "bg-ajax-yellow/[0.07] hover:bg-ajax-yellow/15" : "hover:bg-surface-2",
      )}
    >
      <td className="px-4 py-2 font-medium text-fg">{entry.project || "(no project)"}</td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {entry.week ?? "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {formatSpDate(entry.dateIntoQc)}
      </td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {formatSpDate(entry.dateStarted)}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{entry.sapNo || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{entry.serialNo || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{performedByLabel(entry)}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{entry.hoursRaw || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{entry.effortType ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-2"><HoldChip entry={entry} /></td>
      <td className="whitespace-nowrap px-4 py-2">
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            aria-label={`Edit entry for ${entry.project || "this project"}`}
            className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label={`Delete entry for ${entry.project || "this project"}`}
              title="Delete (duplicates only)"
              className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-cooper-red"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** One entry, phone layout — every populated field gets its own labelled row. */
function EntryCard({
  entry,
  onEdit,
  canDelete,
  onDelete,
}: {
  entry: QcTimeEntry;
  onEdit: () => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const rows: Array<[string, string]> = [
    ["Week", entry.week !== null ? String(entry.week) : "—"],
    ["Into QC", formatSpDate(entry.dateIntoQc)],
    ["Date Started", formatSpDate(entry.dateStarted)],
    ["SAP#", entry.sapNo || "—"],
    ["Serial#", entry.serialNo || "—"],
    ["Performed By", performedByLabel(entry)],
    ["Hours", entry.hoursRaw || "—"],
    ["Effort Type", entry.effortType ?? "—"],
  ];
  return (
    // A DIV, not a button: the delete control has to live inside this card,
    // and a <button> can't contain another one (the same nesting rule that
    // bit SearchableSelect's clear button). The body below is the tappable
    // edit target instead.
    <div
      className={cn(
        "flex w-full flex-col gap-2 px-4 py-3 transition-colors",
        entry.onHold ? "bg-ajax-yellow/[0.07]" : "",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 font-medium text-fg">
          {entry.project || "(no project)"}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit entry for ${entry.project || "this project"}`}
            className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete entry for ${entry.project || "this project"}`}
              title="Delete (duplicates only)"
              className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-cooper-red"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {entry.onHold && <HoldChip entry={entry} />}

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit entry for ${entry.project || "this project"}`}
        className="text-left"
      >
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="truncate text-right text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      </button>
    </div>
  );
}
