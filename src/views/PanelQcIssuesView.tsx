import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ClipboardCheck, MessageSquare, Paperclip, Pencil, Plus, X } from "lucide-react";
import { SearchInput } from "@/components/SearchInput";
import { LoadingTasks } from "@/components/LoadingTasks";
import { usePanelQcIssues } from "@/hooks/usePanelQcIssues";
import type { PanelQcIssue } from "@/types/task";
import { formatSpDate } from "@/lib/spDates";
import { htmlToPlainText } from "@/lib/htmlText";
import { matchesTokens } from "@/lib/itemSearch";
import { dropdownBlurHandler, dropdownKeyHandler, useDropdownClose } from "@/components/useDropdownClose";
import { cn } from "@/lib/cn";

const INITIAL_ROWS = 150;
const display = (value: string | null | undefined) => value || "—";
const displayWatchers = (watchers: PanelQcIssue["watchers"]) => watchers.map((watcher) => watcher.displayName || watcher.email || "Unknown user").join(", ") || "—";
type SortKey = keyof PanelQcIssue;
const SORT_COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "tagNumber", label: "TAG Number" },
  { key: "status", label: "Status" },
  { key: "panelSerialNumber", label: "Panel Serial" },
  { key: "date", label: "Date" },
  { key: "subComponentPartNumber", label: "Part" },
  { key: "partDescription", label: "Description" },
  { key: "subComponentSerialNumber", label: "Sub Component Serial" },
  { key: "defectCategory", label: "Defect" },
  { key: "failureReported", label: "Failure Reported" },
  { key: "panelsResolution", label: "Panels Resolution" },
  { key: "repairTechnician", label: "Repair Tech" },
  { key: "repairIssueFound", label: "Repair Issue Found" },
  { key: "repairResolution", label: "Repair Resolution" },
  { key: "watchers", label: "Watchers" },
  { key: "comments", label: "Comments" },
];

export function comparePanelQcIssues(left: PanelQcIssue, right: PanelQcIssue, key: SortKey, direction: "asc" | "desc") {
  const leftValue = left[key];
  const rightValue = right[key];
  if (key === "comments") {
    const comparison = (leftValue as PanelQcIssue["comments"]).length - (rightValue as PanelQcIssue["comments"]).length;
    return direction === "asc" ? comparison : -comparison;
  }
  if (key === "watchers") {
    const comparison = (leftValue as PanelQcIssue["watchers"]).length - (rightValue as PanelQcIssue["watchers"]).length;
    return direction === "asc" ? comparison : -comparison;
  }
  const leftEmpty = leftValue === null || leftValue === undefined || leftValue === "";
  const rightEmpty = rightValue === null || rightValue === undefined || rightValue === "";
  if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
  if (leftEmpty && rightEmpty) return 0;
  const comparison = key === "date"
    ? (leftValue as Date).getTime() - (rightValue as Date).getTime()
    : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}

/** Everything a search token can match against — plain fields, watcher
 * names, and the plain text of every comment in the thread (the search box
 * says "comments" is in scope, so the thread itself has to be searchable,
 * not just the free-text Failure Reported column). Panel Part Number and
 * Repair Defect Category aren't their own table columns (the table is
 * already wide), but stay findable here. */
function searchableText(issue: PanelQcIssue): string {
  const plainFields = [
    issue.tagNumber, issue.status, issue.panelSerialNumber, issue.panelPartNumber, issue.subComponentPartNumber,
    issue.partDescription, issue.subComponentSerialNumber, issue.defectCategory, issue.failureReported,
    issue.panelsResolution, issue.repairTechnician, issue.repairDefectCategory, issue.repairIssueFound, issue.repairResolution,
  ];
  return [
    ...plainFields.map((value) => value ?? ""),
    displayWatchers(issue.watchers),
    ...issue.comments.map((comment) => htmlToPlainText(comment.bodyHtml)),
  ].join(" ").toLowerCase();
}

/**
 * The raw (untransformed) value a column filter matches on — deliberately
 * NOT run through `display()`'s "—" fallback, so an empty cell's real value
 * stays `""` and can be told apart from "the literal text is an em dash".
 * `ColumnFilterButton` renders `""` as "(Blank)" for the checkbox label only.
 */
export function rawColumnValue(issue: PanelQcIssue, key: SortKey): string {
  if (key === "date") return formatSpDate(issue.date);
  if (key === "watchers") return displayWatchers(issue.watchers);
  if (key === "comments") return String(issue.comments.length);
  const value = issue[key];
  if (typeof value === "string") return value;
  return value == null ? "" : String(value);
}

export function PanelQcIssuesView() {
  const navigate = useNavigate();
  const { data: issues = [], isLoading } = usePanelQcIssues();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("tagNumber");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  // Excel-style per-column filters. No entry for a column means "everything"
  // — a Set present (even empty) means "only these values". Options are
  // computed from the WHOLE loaded list, not the currently-filtered one, so
  // unchecking a value never removes it from a different column's list.
  const [columnFilters, setColumnFilters] = useState<Partial<Record<SortKey, Set<string>>>>({});
  const hasColumnFilters = Object.keys(columnFilters).length > 0;

  const columnOptions = useMemo(() => {
    const result = {} as Record<SortKey, string[]>;
    for (const { key } of SORT_COLUMNS) {
      const seen = new Set(issues.map((issue) => rawColumnValue(issue, key)));
      result[key] = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    }
    return result;
  }, [issues]);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return issues
      .filter((issue) => tokens.every((token) => searchableText(issue).includes(token)))
      .filter((issue) => Object.entries(columnFilters).every(([key, set]) => !set || set.has(rawColumnValue(issue, key as SortKey))))
      .sort((left, right) => comparePanelQcIssues(left, right, sortKey, sortDirection));
  }, [issues, query, columnFilters, sortDirection, sortKey]);
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection("asc"); }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  }

  function setColumnFilter(key: SortKey, next: Set<string> | undefined) {
    setShowAll(false);
    setColumnFilters((prev) => {
      const copy = { ...prev };
      if (next === undefined) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }

  function clearColumnFilters() {
    setShowAll(false);
    setColumnFilters({});
  }

  const emptyMessage = query || hasColumnFilters ? "No issues match that search." : "No issues yet. Click New Issue to record the first.";

  return <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
    <header className="flex flex-wrap items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red"><ClipboardCheck className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Panel QC Issue Tracker</h1><p className="text-sm text-fg-muted">Track panel and board defects from production through resolution.</p></div><button onClick={() => navigate("/panels/qc-issues/new")} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"><Plus className="h-4 w-4" />New Issue</button></header>
    <SearchInput value={query} onChange={(value) => { setQuery(value); setShowAll(false); }} placeholder="Search serial, part, defect, comments, resolution…" />
    <div className="overflow-hidden rounded-xl border border-border bg-surface"><div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg"><span>{isLoading ? "Loading…" : `${filtered.length} issue${filtered.length === 1 ? "" : "s"}`}{(query || hasColumnFilters) && !isLoading && <span className="ml-1 text-fg-muted">of {issues.length}</span>}</span>{hasColumnFilters && <button type="button" onClick={clearColumnFilters} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2"><X className="h-3 w-3" />Clear filters</button>}</div>
      {!showAll && filtered.length > INITIAL_ROWS && <div className="flex justify-between gap-2 border-b border-border bg-ajax-yellow/10 px-4 py-2 text-xs text-fg"><span>Showing {INITIAL_ROWS} of {filtered.length}</span><button onClick={() => setShowAll(true)} className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium hover:bg-surface-2">Show all</button></div>}
      {isLoading ? <LoadingTasks noun="Panel QC issues" /> : <>
        {/* The table (and any OPEN filter dropdown, which lives in its
            <thead>) must stay mounted even when 0 rows currently match —
            unchecking every value in a column filter (or "Select all") is a
            normal, momentary state while the user is about to pick specific
            ones, not a reason to tear down the header row the dropdown is
            anchored to. Only the row area shows the empty message; the
            header/column controls are unconditional (Ray, 2026-09-04: the
            filter panel used to vanish out from under the click the instant
            it matched nothing). */}
        <div className="divide-y divide-border sm:hidden">
          {filtered.length === 0
            ? <div className="px-4 py-10 text-center text-sm text-fg-muted">{emptyMessage}</div>
            : visible.map((issue) => <IssueCard key={issue.id} issue={issue} onEdit={() => navigate(`/panels/qc-issues/${issue.id}`)} />)}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-[1800px] table-fixed text-left text-sm">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                {SORT_COLUMNS.map(({ key, label }) => <th key={key} aria-sort={sortKey === key ? sortDirection === "asc" ? "ascending" : "descending" : "none"} className="whitespace-nowrap px-2 py-2 font-semibold"><div className="flex items-center gap-1"><ColumnFilterButton label={label} options={columnOptions[key]} selected={columnFilters[key]} onChange={(next) => setColumnFilter(key, next)} /><button type="button" onClick={() => toggleSort(key)} aria-label={`Sort by ${label}`} className="rounded p-0.5 text-fg-muted hover:text-fg">{sortIcon(key)}</button></div></th>)}
                <th className="w-9 px-1 py-2"><span className="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={SORT_COLUMNS.length + 1} className="px-4 py-10 text-center text-sm text-fg-muted">{emptyMessage}</td></tr>
                : visible.map((issue) => <IssueRow key={issue.id} issue={issue} onEdit={() => navigate(`/panels/qc-issues/${issue.id}`)} />)}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  </div>;
}

/**
 * Excel-style column filter — click the column LABEL to open a checkbox list
 * of that column's distinct values (search box included for the free-text
 * columns), separate from the sort icon beside it so one click doesn't have
 * to mean both things.
 *
 * `selected === undefined` means "everything" (no filter, the common case).
 * Unchecking the last excluded value — i.e. the set grows back to cover
 * every option — snaps back to `undefined` rather than an equivalent
 * "all of them, explicitly" Set, so `hasColumnFilters` above stays accurate.
 */
function ColumnFilterButton({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string> | undefined;
  onChange: (next: Set<string> | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDropdownClose(open, ref, close, panelRef);

  const active = selected !== undefined;
  const allSelected = selected === undefined;
  const filteredOptions = query.trim()
    ? options.filter((value) => matchesTokens(value || "(Blank)", query))
    : options;

  function toggleValue(value: string) {
    const base = selected ?? new Set(options);
    const next = new Set(base);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next.size === options.length ? undefined : next);
  }

  function toggleAll() {
    onChange(allSelected ? new Set() : undefined);
  }

  return (
    <div
      ref={ref}
      className="relative"
      onBlur={dropdownBlurHandler(ref, close, panelRef)}
      onKeyDown={dropdownKeyHandler(open, close)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex items-center gap-1 whitespace-nowrap hover:text-fg", active && "text-accent")}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Filter ${label}`}
      >
        {label}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 flex max-h-72 w-56 flex-col rounded-lg border border-border bg-surface normal-case tracking-normal text-fg shadow-lg"
        >
          <div className="border-b border-border p-2">
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-xs font-normal text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            <button type="button" onClick={toggleAll} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold text-fg hover:bg-surface-2">
              <CheckboxMark checked={allSelected} />
              Select all
            </button>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-fg-muted">No matches</div>
            ) : (
              filteredOptions.map((value) => {
                const checked = allSelected || selected!.has(value);
                return (
                  <button key={value} type="button" onClick={() => toggleValue(value)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-normal text-fg hover:bg-surface-2">
                    <CheckboxMark checked={checked} />
                    <span className="truncate">{value || "(Blank)"}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex justify-end border-t border-border px-2 py-1.5">
            <button type="button" onClick={close} className="rounded-md px-2.5 py-1 text-xs font-medium text-accent hover:bg-surface-2">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckboxMark({ checked }: { checked: boolean }) {
  return (
    <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border", checked ? "border-accent bg-accent text-white" : "border-border bg-surface")}>
      {checked && <Check className="h-2.5 w-2.5" />}
    </span>
  );
}

function IssueRow({ issue, onEdit }: { issue: PanelQcIssue; onEdit: () => void }) { return <tr onClick={onEdit} className="cursor-pointer border-t border-border align-top hover:bg-surface-2"><td className="break-words px-2 py-2 font-medium text-fg">{display(issue.tagNumber)}{issue.hasAttachments && <Paperclip className="ml-1 inline h-3 w-3 text-fg-muted" aria-label="Has attachments" />}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.status)}</td><td className="break-words px-2 py-2 font-medium text-fg">{display(issue.panelSerialNumber)}</td><td className="break-words px-2 py-2 text-fg-muted">{formatSpDate(issue.date)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.subComponentPartNumber)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.partDescription)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.subComponentSerialNumber)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.defectCategory)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.failureReported)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.panelsResolution)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.repairTechnician)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.repairIssueFound)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.repairResolution)}</td><td className="break-words px-2 py-2 text-fg-muted">{displayWatchers(issue.watchers)}</td><td className="px-2 py-2 text-fg-muted">{issue.comments.length > 0 ? <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{issue.comments.length}</span> : "—"}</td><td className="w-9 px-1 py-2"><button type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }} aria-label={`Edit issue ${issue.panelSerialNumber}`} className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"><Pencil className="h-4 w-4" /></button></td></tr>; }

function IssueCard({ issue, onEdit }: { issue: PanelQcIssue; onEdit: () => void }) { return <button type="button" onClick={onEdit} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-surface-2"><div className="flex items-start justify-between gap-2"><span className="font-medium text-fg">{display(issue.tagNumber)} · {display(issue.panelSerialNumber)}{issue.hasAttachments && <Paperclip className="ml-1 inline h-3 w-3 text-fg-muted" aria-label="Has attachments" />}</span><Pencil className="h-4 w-4 shrink-0 text-fg-muted" /></div><dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm"><dt className="text-fg-muted">Status</dt><dd className="truncate text-right text-fg">{display(issue.status)}</dd><dt className="text-fg-muted">Date</dt><dd className="truncate text-right text-fg">{formatSpDate(issue.date)}</dd><dt className="text-fg-muted">Part</dt><dd className="truncate text-right text-fg">{display(issue.subComponentPartNumber)}</dd><dt className="text-fg-muted">Defect</dt><dd className="truncate text-right text-fg">{display(issue.defectCategory)}</dd><dt className="text-fg-muted">Description</dt><dd className="truncate text-right text-fg">{display(issue.partDescription)}</dd><dt className="text-fg-muted">Watchers</dt><dd className="truncate text-right text-fg">{displayWatchers(issue.watchers)}</dd><dt className="text-fg-muted">Comments</dt><dd className="truncate text-right text-fg">{issue.comments.length}</dd></dl></button>; }
