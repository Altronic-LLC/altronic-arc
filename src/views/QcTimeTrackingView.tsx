import { useMemo, useState } from "react";
import { Pencil, Plus, Timer } from "lucide-react";
import { useQcTimeEntries } from "@/hooks/useQcTimeTracking";
import type { QcTimeEntry } from "@/types/task";
import { formatSpDate } from "@/lib/spDates";
import { SearchInput } from "@/components/SearchInput";
import { LoadingTasks } from "@/components/LoadingTasks";
import { QcTimeEntryFormModal } from "@/components/QcTimeEntryFormModal";

// =============================================================================
// QC Time Tracking — Panels' log of hours QC spends on a project.
//
// A plain table, not a detail-page + list pair like Visit Reports: this list
// has no comments, no watchers, no attachments — every field fits on one row,
// so clicking a row opens the SAME form modal in edit mode rather than
// navigating to a separate page. Any signed-in user can add or edit an entry;
// there is no delete (see api/qcTimeTracking.ts) and no admin gate.
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
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<QcTimeEntry | null>(null);

  const filtered = useMemo(
    () => entries.filter((e) => matches(e, query)),
    [entries, query],
  );
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

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
            {query && !isLoading && (
              <span className="ml-1 text-fg-muted">of {entries.length}</span>
            )}
          </h2>
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
                <EntryCard key={entry.id} entry={entry} onEdit={() => setEditing(entry)} />
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Project</th>
                    <th className="px-4 py-2 font-semibold">Week</th>
                    <th className="px-4 py-2 font-semibold">Date Started</th>
                    <th className="px-4 py-2 font-semibold">SAP#</th>
                    <th className="px-4 py-2 font-semibold">Serial#</th>
                    <th className="px-4 py-2 font-semibold">Performed By</th>
                    <th className="px-4 py-2 font-semibold">Hours</th>
                    <th className="px-4 py-2 font-semibold">Effort Type</th>
                    <th className="px-4 py-2"><span className="sr-only">Edit</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => (
                    <Row key={entry.id} entry={entry} onEdit={() => setEditing(entry)} />
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

function Row({ entry, onEdit }: { entry: QcTimeEntry; onEdit: () => void }) {
  return (
    <tr
      onClick={onEdit}
      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
    >
      <td className="px-4 py-2 font-medium text-fg">{entry.project || "(no project)"}</td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {entry.week ?? "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {formatSpDate(entry.dateStarted)}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{entry.sapNo || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{entry.serialNo || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{performedByLabel(entry)}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{entry.hoursRaw || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{entry.effortType ?? "—"}</td>
      <td className="px-4 py-2">
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
      </td>
    </tr>
  );
}

/** One entry, phone layout — every populated field gets its own labelled row. */
function EntryCard({ entry, onEdit }: { entry: QcTimeEntry; onEdit: () => void }) {
  const rows: Array<[string, string]> = [
    ["Week", entry.week !== null ? String(entry.week) : "—"],
    ["Date Started", formatSpDate(entry.dateStarted)],
    ["SAP#", entry.sapNo || "—"],
    ["Serial#", entry.serialNo || "—"],
    ["Performed By", performedByLabel(entry)],
    ["Hours", entry.hoursRaw || "—"],
    ["Effort Type", entry.effortType ?? "—"],
  ];
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Edit entry for ${entry.project || "this project"}`}
      className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-fg">{entry.project || "(no project)"}</span>
        <Pencil className="h-4 w-4 shrink-0 text-fg-muted" />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="truncate text-right text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </button>
  );
}
