import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { matchesTokens } from "@/lib/itemSearch";
import {
  dropdownBlurHandler,
  dropdownKeyHandler,
  useDropdownClose,
} from "./useDropdownClose";

// =============================================================================
// Sortable, filterable table headers.
//
// Lifted OUT of `PanelQcIssuesView` (Ray, 2026-09-16: "add the sort buttons to
// all apps tools lists in arc like it is in Panel Qc issue tracker"). It was
// private to that one view, and pasting it per list is how one copy drifts —
// the note inside `ColumnFilterButton` about the portal position and the
// `autoFocus` bug is exactly the kind of hard-won detail that would be lost
// in a copy.
//
// Two separate affordances per column, deliberately: clicking the LABEL opens
// the value filter, clicking the ICON beside it sorts. One click doesn't have
// to mean both things.
// =============================================================================

export type SortDirection = "asc" | "desc";

/**
 * The sort state a table holds, and the toggle that drives it.
 *
 * First click on a new column sorts ASCENDING; clicking the column you're
 * already on flips direction. That is what people expect from a spreadsheet.
 */
export function useTableSort<K extends string>(initialKey: K, initialDirection: SortDirection = "asc") {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialDirection);

  const toggleSort = useCallback((key: K) => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        return currentKey;
      }
      setSortDirection("asc");
      return key;
    });
  }, []);

  return { sortKey, sortDirection, toggleSort };
}

/** The sort indicator for one column — faint when it isn't the active one. */
export function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  return direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

/**
 * A `<th>` carrying both affordances, plus the `aria-sort` a screen reader
 * needs to announce the current order.
 */
export function SortableHeader<K extends string>({
  columnKey,
  label,
  sortKey,
  sortDirection,
  onToggleSort,
  options,
  selected,
  onFilterChange,
  className,
}: {
  columnKey: K;
  label: string;
  sortKey: K;
  sortDirection: SortDirection;
  onToggleSort: (key: K) => void;
  /** Distinct values for the filter menu. Omit to offer sorting only. */
  options?: string[];
  selected?: Set<string> | undefined;
  onFilterChange?: (next: Set<string> | undefined) => void;
  className?: string;
}) {
  const active = sortKey === columnKey;
  return (
    <th
      aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
      className={cn("whitespace-nowrap px-4 py-2 font-semibold", className)}
    >
      <div className="flex items-center gap-1">
        {options && onFilterChange ? (
          <ColumnFilterButton
            label={label}
            options={options}
            selected={selected}
            onChange={onFilterChange}
          />
        ) : (
          <span className="whitespace-nowrap">{label}</span>
        )}
        <button
          type="button"
          onClick={() => onToggleSort(columnKey)}
          aria-label={`Sort by ${label}`}
          className="rounded p-0.5 text-fg-muted hover:text-fg"
        >
          <SortIcon active={active} direction={sortDirection} />
        </button>
      </div>
    </th>
  );
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
export function ColumnFilterButton({
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

  // The trigger sits inside the table's horizontally-scrolling wrapper,
  // which clips vertical overflow too (an `overflow-x-auto` element without
  // an explicit `overflow-y` gets `overflow-y: auto` from the UA, not
  // `visible`) — so a plain `absolute` panel got squeezed into whatever
  // room was left in the row area instead of overlaying the page. Portaling
  // to <body> with a `fixed` position, computed straight from the trigger's
  // rect, escapes that.
  //
  // Computed HERE during render, not via a `useLayoutEffect` + `setState`:
  // `ref.current` is the trigger's OWN wrapper, already mounted from a prior
  // commit and unmoved by opening, so reading its rect mid-render is safe,
  // and it mounts the portal in the SAME commit `open` turns true rather
  // than a follow-up one.
  //
  // That still wasn't enough on its own (reported 2026-09-04: "the filter
  // popup doesn't work at all" — it opened and closed itself instantly).
  // The search input below used to carry `autoFocus`, which steals focus
  // from the trigger the moment the portal mounts — even in this same
  // commit — and React attaches a ref to an ANCESTOR (`panelRef`, here)
  // only AFTER a `autoFocus` descendant's own commit-time `.focus()` call,
  // not before. So the trigger's resulting blur reached
  // `dropdownBlurHandler` while `panelRef.current` was still `null`, which
  // made its "is the new focus still inside our own panel?" check fail and
  // close the panel it had just opened. Dropping `autoFocus` removes the
  // only thing that moved focus in the first place, so opening the panel no
  // longer blurs the trigger at all.
  const portalPosition = open && ref.current
    ? (() => {
        const rect = ref.current!.getBoundingClientRect();
        return { left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 224) };
      })()
    : null;

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
      {open && portalPosition && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          style={{ left: portalPosition.left, top: portalPosition.top, width: portalPosition.width }}
          className="fixed z-[100] flex max-h-72 flex-col rounded-lg border border-border bg-surface normal-case tracking-normal text-fg shadow-lg"
        >
          <div className="border-b border-border p-2">
            <input
              type="search"
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
        </div>,
        document.body,
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
