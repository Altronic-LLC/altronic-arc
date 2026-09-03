import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ClipboardCheck, Pencil, Plus } from "lucide-react";
import { SearchInput } from "@/components/SearchInput";
import { LoadingTasks } from "@/components/LoadingTasks";
import { usePanelQcIssues } from "@/hooks/usePanelQcIssues";
import type { PanelQcIssue } from "@/types/task";
import { formatSpDate } from "@/lib/spDates";

const INITIAL_ROWS = 150;
const display = (value: string | null | undefined) => value || "—";
const displayWatchers = (watchers: PanelQcIssue["watchers"]) => watchers.map((watcher) => watcher.displayName || watcher.email || "Unknown user").join(", ") || "—";
type SortKey = keyof PanelQcIssue;
const SORT_COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "tagNumber", label: "TAG Number" },
  { key: "panelSerialNumber", label: "Panel / Board Serial" },
  { key: "date", label: "Date" },
  { key: "partNumber", label: "Part" },
  { key: "partDescription", label: "Description" },
  { key: "serialReferenceNote", label: "Serial Note" },
  { key: "defectCategory", label: "Defect" },
  { key: "comments", label: "Comments" },
  { key: "correctiveAction", label: "Corrective Action" },
  { key: "productionTechnician", label: "Technician" },
  { key: "productionRepairNotes", label: "Repair Notes" },
  { key: "productionResolution", label: "Resolution" },
  { key: "communication", label: "Communication" },
  { key: "watchers", label: "Watchers" },
];

export function comparePanelQcIssues(left: PanelQcIssue, right: PanelQcIssue, key: SortKey, direction: "asc" | "desc") {
  const leftValue = left[key];
  const rightValue = right[key];
  const leftEmpty = leftValue === null || leftValue === undefined || leftValue === "";
  const rightEmpty = rightValue === null || rightValue === undefined || rightValue === "";
  if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
  if (leftEmpty && rightEmpty) return 0;
  const comparison = key === "date"
    ? (leftValue as Date).getTime() - (rightValue as Date).getTime()
    : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}

export function PanelQcIssuesView() {
  const navigate = useNavigate();
  const { data: issues = [], isLoading } = usePanelQcIssues();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("tagNumber");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return issues
      .filter((issue) => tokens.every((token) => Object.values(issue).some((value) => String(value ?? "").toLowerCase().includes(token))))
      .sort((left, right) => comparePanelQcIssues(left, right, sortKey, sortDirection));
  }, [issues, query, sortDirection, sortKey]);
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection("asc"); }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  }

  return <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
    <header className="flex flex-wrap items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red"><ClipboardCheck className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Panel QC Issue Tracker</h1><p className="text-sm text-fg-muted">Track panel and board defects from production through resolution.</p></div><button onClick={() => navigate("/panels/qc-issues/new")} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"><Plus className="h-4 w-4" />New Issue</button></header>
    <SearchInput value={query} onChange={(value) => { setQuery(value); setShowAll(false); }} placeholder="Search serial, part, defect, comments, resolution…" />
    <div className="overflow-hidden rounded-xl border border-border bg-surface"><div className="border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">{isLoading ? "Loading…" : `${filtered.length} issue${filtered.length === 1 ? "" : "s"}`}{query && !isLoading && <span className="ml-1 text-fg-muted">of {issues.length}</span>}</div>
      {!showAll && filtered.length > INITIAL_ROWS && <div className="flex justify-between gap-2 border-b border-border bg-ajax-yellow/10 px-4 py-2 text-xs text-fg"><span>Showing {INITIAL_ROWS} of {filtered.length}</span><button onClick={() => setShowAll(true)} className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium hover:bg-surface-2">Show all</button></div>}
      {isLoading ? <LoadingTasks noun="Panel QC issues" /> : filtered.length === 0 ? <div className="px-4 py-10 text-center text-sm text-fg-muted">{query ? "No issues match that search." : "No issues yet. Click New Issue to record the first."}</div> : <><div className="divide-y divide-border sm:hidden">{visible.map((issue) => <IssueCard key={issue.id} issue={issue} onEdit={() => navigate(`/panels/qc-issues/${issue.id}`)} />)}</div><div className="hidden overflow-x-auto sm:block"><table className="min-w-[1700px] table-fixed text-left text-sm"><thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted"><tr>{SORT_COLUMNS.map(({ key, label }) => <th key={key} aria-sort={sortKey === key ? sortDirection === "asc" ? "ascending" : "descending" : "none"} className="whitespace-nowrap px-2 py-2 font-semibold"><button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-fg">{label}{sortIcon(key)}</button></th>)}<th className="w-9 px-1 py-2"><span className="sr-only">Edit</span></th></tr></thead><tbody>{visible.map((issue) => <IssueRow key={issue.id} issue={issue} onEdit={() => navigate(`/panels/qc-issues/${issue.id}`)} />)}</tbody></table></div></>}
    </div>
  </div>;
}

function IssueRow({ issue, onEdit }: { issue: PanelQcIssue; onEdit: () => void }) { return <tr onClick={onEdit} className="cursor-pointer border-t border-border align-top hover:bg-surface-2"><td className="break-words px-2 py-2 font-medium text-fg">{display(issue.tagNumber)}</td><td className="break-words px-2 py-2 font-medium text-fg">{display(issue.panelSerialNumber)}</td><td className="break-words px-2 py-2 text-fg-muted">{formatSpDate(issue.date)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.partNumber)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.partDescription)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.serialReferenceNote)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.defectCategory)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.comments)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.correctiveAction)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.productionTechnician)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.productionRepairNotes)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.productionResolution)}</td><td className="break-words px-2 py-2 text-fg-muted">{display(issue.communication)}</td><td className="break-words px-2 py-2 text-fg-muted">{displayWatchers(issue.watchers)}</td><td className="w-9 px-1 py-2"><button type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }} aria-label={`Edit issue ${issue.panelSerialNumber}`} className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"><Pencil className="h-4 w-4" /></button></td></tr>; }

function IssueCard({ issue, onEdit }: { issue: PanelQcIssue; onEdit: () => void }) { return <button type="button" onClick={onEdit} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-surface-2"><div className="flex items-start justify-between gap-2"><span className="font-medium text-fg">{display(issue.tagNumber)} · {display(issue.panelSerialNumber)}</span><Pencil className="h-4 w-4 shrink-0 text-fg-muted" /></div><dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm"><dt className="text-fg-muted">Date</dt><dd className="truncate text-right text-fg">{formatSpDate(issue.date)}</dd><dt className="text-fg-muted">Part</dt><dd className="truncate text-right text-fg">{display(issue.partNumber)}</dd><dt className="text-fg-muted">Defect</dt><dd className="truncate text-right text-fg">{display(issue.defectCategory)}</dd><dt className="text-fg-muted">Description</dt><dd className="truncate text-right text-fg">{display(issue.partDescription)}</dd><dt className="text-fg-muted">Watchers</dt><dd className="truncate text-right text-fg">{displayWatchers(issue.watchers)}</dd><dt className="text-fg-muted">Communication</dt><dd className="truncate text-right text-fg">{display(issue.communication)}</dd></dl></button>; }