import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

interface BaseProps {
  options: SelectOption[];
  /** Text on the trigger button when nothing is selected (e.g. "Anyone"). */
  allLabel: string;
  /** Placeholder inside the search input at the top of the dropdown panel. */
  searchPlaceholder?: string;
}

export interface MultiSelectProps extends BaseProps {
  selected: string[];
  onChange: (next: string[]) => void;
  /**
   * Trigger display style.
   * - "summary" (default): compact "<first> +N" line. Best for filter bars
   *   where vertical space is tight.
   * - "chips": each selection is stacked as its own removable chip so they
   *   all stay visible, with an "Add / edit" row that opens the picker. Best
   *   for form/detail fields where seeing the full selection matters.
   */
  variant?: "summary" | "chips";
}

export interface SingleSelectProps extends BaseProps {
  selected: string | null;
  onChange: (next: string | null) => void;
}

/**
 * Multi-select dropdown with an integrated search field. The trigger shows
 * "All projects" when empty, the single label when one is selected, or
 * "<first> +N" when multiple are. The dropdown stays open while picking so
 * the user can toggle several items.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  allLabel,
  searchPlaceholder,
  variant = "summary",
}: MultiSelectProps) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  let summary: string;
  const selectedOpts = options.filter((o) => selectedSet.has(o.value));
  if (selectedOpts.length === 0) summary = allLabel;
  else if (selectedOpts.length === 1) summary = selectedOpts[0].label;
  else summary = `${selectedOpts[0].label} +${selectedOpts.length - 1}`;

  return (
    <DropdownShell
      summary={summary}
      isEmpty={selectedOpts.length === 0}
      onClear={selectedOpts.length > 0 ? () => onChange([]) : undefined}
      chips={variant === "chips" ? selectedOpts : undefined}
      onRemoveChip={(value) => onChange(selected.filter((x) => x !== value))}
      renderPanel={({ close }) => (
        <SearchablePanel
          options={options}
          searchPlaceholder={searchPlaceholder}
          isSelected={(v) => selectedSet.has(v)}
          onToggle={(v) => {
            if (selectedSet.has(v)) onChange(selected.filter((x) => x !== v));
            else onChange([...selected, v]);
            // Don't close — let the user pick multiple.
            void close;
          }}
        />
      )}
    />
  );
}

/**
 * Single-select dropdown with an integrated search field. Picking an option
 * closes the panel (matching native `<select>` behavior). Selecting the
 * already-selected option clears the value back to `null`.
 */
export function SingleSelect({
  options,
  selected,
  onChange,
  allLabel,
  searchPlaceholder,
}: SingleSelectProps) {
  const selectedOpt = options.find((o) => o.value === selected) ?? null;
  const summary = selectedOpt?.label ?? allLabel;

  return (
    <DropdownShell
      summary={summary}
      isEmpty={selectedOpt == null}
      onClear={selectedOpt ? () => onChange(null) : undefined}
      renderPanel={({ close }) => (
        <SearchablePanel
          options={options}
          searchPlaceholder={searchPlaceholder}
          isSelected={(v) => v === selected}
          onToggle={(v) => {
            onChange(v === selected ? null : v);
            close();
          }}
        />
      )}
    />
  );
}

interface DropdownShellProps {
  summary: string;
  isEmpty: boolean;
  onClear?: () => void;
  renderPanel: (api: { close: () => void }) => React.ReactNode;
  /**
   * When provided AND non-empty, the trigger renders these as stacked,
   * removable chips plus an "Add / edit" row instead of the one-line summary.
   * (Nested chips can't live inside the summary <button>, so this swaps the
   * whole trigger for a container with its own buttons.)
   */
  chips?: SelectOption[];
  onRemoveChip?: (value: string) => void;
}

/**
 * Shared chrome — trigger button styled like the .select inputs, the chevron,
 * an optional inline clear (✕) button, and a panel that closes on outside
 * click / Escape. The panel content is delegated to a render-prop so the
 * Multi vs Single variants can inject their own option list.
 */
function DropdownShell({
  summary,
  isEmpty,
  onClear,
  renderPanel,
  chips,
  onRemoveChip,
}: DropdownShellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const useChips = chips !== undefined && chips.length > 0;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {useChips ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-1.5">
          {chips!.map((c) => (
            <span
              key={c.value}
              className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1 text-sm text-fg"
            >
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {onRemoveChip && (
                <button
                  type="button"
                  onClick={() => onRemoveChip(c.value)}
                  className="shrink-0 rounded-full p-0.5 text-fg-muted hover:bg-bg hover:text-fg"
                  aria-label={`Remove ${c.label}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          ))}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className="flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" /> Add / edit
            </span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="select flex items-center justify-between gap-2 text-left"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={cn("min-w-0 flex-1 truncate", isEmpty && "text-fg-muted")}>{summary}</span>
          <div className="flex shrink-0 items-center gap-1">
            {onClear && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="rounded-full p-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <ChevronDown
              className={cn("h-4 w-4 text-fg-muted transition-transform", open && "rotate-180")}
            />
          </div>
        </button>
      )}

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 flex max-h-80 flex-col rounded-lg border border-border bg-surface shadow-lg"
        >
          {renderPanel({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

interface SearchablePanelProps {
  options: SelectOption[];
  searchPlaceholder?: string;
  isSelected: (value: string) => boolean;
  onToggle: (value: string) => void;
}

function SearchablePanel({
  options,
  searchPlaceholder,
  isSelected,
  onToggle,
}: SearchablePanelProps) {
  const [query, setQuery] = useState("");

  // Snapshot which options were selected when the panel opened, so checked
  // items float to the top — but DON'T re-sort as the user toggles them
  // (that would make the row jump out from under the cursor mid-click).
  const initiallySelected = useRef<Set<string> | null>(null);
  if (initiallySelected.current === null) {
    initiallySelected.current = new Set(
      options.filter((o) => isSelected(o.value)).map((o) => o.value),
    );
  }

  // Stable sort (selected-first) preserves the caller's original order
  // within each group.
  const ordered = useMemo(() => {
    const sel = initiallySelected.current!;
    return [...options].sort(
      (a, b) => (sel.has(a.value) ? 0 : 1) - (sel.has(b.value) ? 0 : 1),
    );
  }, [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((o) => o.label.toLowerCase().includes(q));
  }, [ordered, query]);

  return (
    <>
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder ?? "Search…"}
            className="w-full rounded-md border border-border bg-bg py-1.5 pl-7 pr-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-fg-muted">No matches</div>
        ) : (
          filtered.map((o) => {
            const selected = isSelected(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onToggle(o.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  selected ? "bg-accent/10 text-fg" : "text-fg hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    selected
                      ? "border-accent bg-accent text-white"
                      : "border-border bg-surface",
                  )}
                >
                  {selected && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
