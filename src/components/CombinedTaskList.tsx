import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useSortableTable } from "@/hooks/useSortableTable";
import {
  COMBINED_DEPARTMENTS,
  COMBINED_SORT_COLUMNS,
  combinedTaskKey,
  combinedTaskPath,
  type CombinedDepartment,
  type CombinedTask,
} from "@/lib/combinedTasks";
import { isAccessDeniedError } from "@/lib/listAccess";
import { cn } from "@/lib/cn";
import { LoadingTasks } from "./LoadingTasks";
import { ListAccessNotice } from "./ListAccessNotice";
import { ChoiceSelect } from "./SearchableSelect";
import { OperationsTaskRow } from "./OperationsTaskRow";
import { TaskRow } from "./TaskRow";

// =============================================================================
// The pieces the Engineering and Operations task lists share for their
// "this department + the other one" scope (BusinessIT#39, Tim, 2026-10-12). One copy, so a
// fix to the sort bar or the row cap can't reach one list and not the other.
// The merge rules themselves are in lib/combinedTasks.ts.
// =============================================================================

// What's RENDERED is capped, with a "Show all" — the combined scope puts two
// whole task lists on one screen, and hundreds of rows re-mounting on every
// keystroke in the search box is the freeze CLAUDE.md warns about. Filtering,
// sorting and every count still run over the full set.
const INITIAL_ROWS = 150;

/** The "this list only / both lists" switch at the top of a task list. */
export function TaskScopeToggle({
  allScope,
  ownLabel,
  allLabel,
  onChange,
}: {
  allScope: boolean;
  ownLabel: string;
  allLabel: string;
  onChange: (all: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Which tasks"
      className="inline-flex rounded-md border border-border bg-surface p-0.5 text-sm"
    >
      <ScopeButton active={!allScope} onClick={() => allScope && onChange(false)}>
        {ownLabel}
      </ScopeButton>
      <ScopeButton active={allScope} onClick={() => !allScope && onChange(true)}>
        {allLabel}
      </ScopeButton>
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1 font-medium transition-colors",
        active ? "bg-accent text-white shadow-sm" : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The Department filter, for `FilterBar`'s `replaceProjectWith` in the
 * both-departments scope — the two lists use different project lists, so
 * Project can't be right for both halves.
 */
export function departmentField(
  department: CombinedDepartment | null,
  setDepartment: (d: CombinedDepartment | null) => void,
) {
  return {
    label: "Department",
    control: (
      <ChoiceSelect
        emptyLabel="All departments"
        options={COMBINED_DEPARTMENTS}
        value={department ?? ""}
        onChange={(v) => setDepartment((v || null) as CombinedDepartment | null)}
      />
    ),
  };
}

/**
 * The OTHER department's list failed to load. A failed read must never look
 * like "that department has no tasks" — this department's tasks still show
 * below it.
 */
export function OtherTaskListNotice({
  error,
  department,
  list,
  site,
  shownDepartment,
  onRetry,
}: {
  error: unknown;
  /** The department whose list failed, e.g. "Engineering". */
  department: string;
  list: string;
  site: string;
  /** The department still shown, e.g. "Operations". */
  shownDepartment: string;
  onRetry: () => void;
}) {
  if (isAccessDeniedError(error)) {
    return <ListAccessNotice list={`${list} (${department} tasks)`} site={site} onRetry={onRetry} />;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <span className="text-fg">
        {department} tasks couldn't be loaded, so only {shownDepartment} tasks are shown.
      </span>
      <button type="button" onClick={onRetry} className="font-medium text-accent hover:underline">
        Try again
      </button>
    </div>
  );
}

/**
 * The sortable, capped list of rows under the filter bar. Each row opens its
 * OWN department's task page — the combined list is read-only.
 */
export function CombinedTaskResults({
  rows,
  total,
  isLoading,
  showDepartment,
  resetKey,
}: {
  /** Already filtered by the bar and the pills. */
  rows: CombinedTask[];
  /** Every task loaded, for "Showing N of M". */
  total: number;
  isLoading: boolean;
  /** Mark each row with its department — only when two lists are mixed. */
  showDepartment: boolean;
  /** Changes whenever a filter does, so "show all" resets once the list is narrowed. */
  resetKey: string;
}) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const table = useSortableTable({
    rows,
    columns: COMBINED_SORT_COLUMNS,
    stableKey: combinedTaskKey,
    // Newest first — both lists' order before the sort picker existed.
    initialKey: "created",
    initialDirection: "desc",
  });

  // A narrowed list is exactly when "show all" should reset — the cap is for
  // the unfiltered case, not to keep hiding rows once somebody has narrowed.
  useEffect(() => {
    setShowAll(false);
  }, [resetKey, table.sortKey, table.sortDirection]);

  if (isLoading) return <LoadingTasks />;
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
        No tasks match the current filters.
      </div>
    );
  }

  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);
  const ascending = table.sortDirection === "asc";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span>
          Showing {rows.length} of {total} tasks
        </span>
        <div className="flex items-center gap-2">
          {shown.length < table.rows.length && (
            <button
              onClick={() => setShowAll(true)}
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Showing {shown.length.toLocaleString()} — show all
            </button>
          )}
          <span className="shrink-0 font-medium">Sort by</span>
          <div className="w-40">
            <ChoiceSelect
              ariaLabel="Sort by"
              emptyLabel="Created"
              options={COMBINED_SORT_COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
              value={table.sortKey}
              onChange={(key) => key && key !== table.sortKey && table.toggleSort(key)}
              clearable={false}
            />
          </div>
          <button
            type="button"
            onClick={() => table.toggleSort(table.sortKey)}
            aria-label={
              ascending
                ? "Sorted ascending — switch to descending"
                : "Sorted descending — switch to ascending"
            }
            title={ascending ? "Ascending" : "Descending"}
            className="shrink-0 rounded-md border border-border p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            {ascending ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {shown.map((row) =>
        row.department === "Engineering" ? (
          <TaskRow
            key={`e${row.task.id}`}
            task={row.task}
            department={showDepartment ? row.department : undefined}
            onOpen={() => navigate(combinedTaskPath(row))}
          />
        ) : (
          <OperationsTaskRow
            key={`o${row.task.id}`}
            task={row.task}
            department={showDepartment ? row.department : undefined}
            onOpen={() => navigate(combinedTaskPath(row))}
          />
        ),
      )}
    </div>
  );
}
