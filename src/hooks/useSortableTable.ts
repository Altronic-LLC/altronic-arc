import { useCallback, useMemo, useState } from "react";
import {
  allColumnOptions,
  applyColumnFilters,
  sortRows,
  type SortColumn,
  type SortDirection,
} from "@/lib/tableSort";

// =============================================================================
// Everything a sortable, filterable table needs, in one hook.
//
// A view declares its columns as DATA (accessors, see `lib/tableSort.ts`) and
// gets back the sorted, filtered rows plus the props each header needs. That
// is the whole point: seven lists gained sorting on 2026-09-16 without seven
// copies of the state, the option computation and the filter reset.
//
// Pair it with `SortableHeader` from `components/SortableTableHeader.tsx`.
// =============================================================================

export interface UseSortableTableOptions<T> {
  rows: T[];
  columns: SortColumn<T>[];
  /** Ties break on this, descending — pass the row id. */
  stableKey: (row: T) => number;
  initialKey: string;
  initialDirection?: SortDirection;
  /** Called whenever the sort or a filter changes — e.g. to reset a row cap. */
  onChange?: () => void;
}

export function useSortableTable<T>({
  rows,
  columns,
  stableKey,
  initialKey,
  initialDirection = "asc",
  onChange,
}: UseSortableTableOptions<T>) {
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialDirection);
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string> | undefined>>({});

  const toggleSort = useCallback(
    (key: string) => {
      // First click on a NEW column sorts ascending; clicking the column you
      // are already on flips it. What a spreadsheet does.
      if (key === sortKey) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortKey(key);
        setSortDirection("asc");
      }
      onChange?.();
    },
    [sortKey, onChange],
  );

  const setColumnFilter = useCallback(
    (key: string, next: Set<string> | undefined) => {
      setColumnFilters((prev) => {
        const out = { ...prev };
        if (next === undefined) delete out[key];
        else out[key] = next;
        return out;
      });
      onChange?.();
    },
    [onChange],
  );

  // Options come from the WHOLE list handed in, not the filtered result, so
  // unchecking a value never removes it from a different column's menu.
  const options = useMemo(() => allColumnOptions(rows, columns), [rows, columns]);

  const visibleRows = useMemo(
    () =>
      sortRows(
        applyColumnFilters(rows, columns, columnFilters),
        columns,
        sortKey,
        sortDirection,
        stableKey,
      ),
    [rows, columns, columnFilters, sortKey, sortDirection, stableKey],
  );

  const hasFilters = Object.values(columnFilters).some((s) => s !== undefined && s.size > 0);

  /** Spread onto a `SortableHeader` for one column. */
  const headerProps = useCallback(
    (key: string) => ({
      columnKey: key,
      sortKey,
      sortDirection,
      onToggleSort: toggleSort,
      options: options[key]?.length ? options[key] : undefined,
      selected: columnFilters[key],
      onFilterChange: (next: Set<string> | undefined) => setColumnFilter(key, next),
    }),
    [sortKey, sortDirection, toggleSort, options, columnFilters, setColumnFilter],
  );

  const clearFilters = useCallback(() => {
    setColumnFilters({});
    onChange?.();
  }, [onChange]);

  return {
    rows: visibleRows,
    sortKey,
    sortDirection,
    toggleSort,
    columnFilters,
    setColumnFilter,
    clearFilters,
    hasFilters,
    options,
    headerProps,
  };
}
