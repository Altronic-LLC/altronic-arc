import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { ChoiceSelect } from "./SearchableSelect";

// =============================================================================
// A phone's card list has no column headers, so sorting is a "Sort by" picker
// plus a direction button over the SAME sort state the table's headers drive
// (useSortableTable) — turning a phone sideways and back keeps the order.
// A column filter set on a wider screen can't be seen on a phone, so the bar
// says one is narrowing the list and offers to clear it. The Parts List's
// PartCards does the same; this is the shared version for new card lists.
// =============================================================================

export function PhoneSortBar({
  columns,
  table,
}: {
  columns: { key: string; label: string }[];
  table: {
    sortKey: string;
    sortDirection: "asc" | "desc";
    toggleSort: (key: string) => void;
    hasFilters: boolean;
    clearFilters: () => void;
  };
}) {
  const ascending = table.sortDirection === "asc";
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="shrink-0 text-xs font-medium text-fg-muted">Sort by</span>
        <div className="min-w-0 flex-1">
          <ChoiceSelect
            ariaLabel="Sort by"
            emptyLabel={columns[0]?.label ?? "Sort"}
            options={columns.map((c) => ({ value: c.key, label: c.label }))}
            value={table.sortKey}
            onChange={(key) => key && key !== table.sortKey && table.toggleSort(key)}
            clearable={false}
          />
        </div>
        <button
          type="button"
          onClick={() => table.toggleSort(table.sortKey)}
          aria-label={ascending ? "Sorted ascending — switch to descending" : "Sorted descending — switch to ascending"}
          className="shrink-0 rounded-md border border-border p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          {ascending ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
        </button>
      </div>
      {table.hasFilters && (
        <div className="flex items-center gap-2 border-b border-border bg-ajax-yellow/10 px-3 py-2 text-xs text-fg">
          A column filter is narrowing this list.
          <button type="button" onClick={table.clearFilters} className="ml-auto font-medium text-accent underline">
            Clear
          </button>
        </div>
      )}
    </>
  );
}
