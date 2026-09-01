import { useCallback, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { matchesTokens } from "@/lib/itemSearch";
import {
  dropdownBlurHandler,
  dropdownKeyHandler,
  useDropdownClose,
} from "./useDropdownClose";

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
  /** Accessible name, when no <label> wraps this. */
  ariaLabel?: string;
  /** Greyed out and unopenable — for a form that's mid-save. */
  disabled?: boolean;
  /**
   * Tooltip on the control, for the "why is this locked" hint on a gated field.
   *
   * It sits on the WRAPPER, not the trigger button: a disabled `<button>`
   * suppresses its own native tooltip in Chrome and Edge (the same reason the
   * EIR status pills use `aria-disabled`). Treat it as a convenience — a
   * refusal a user has to act on is said out loud on the page as well.
   */
  title?: string;
  /**
   * false for a field that must always hold a value (a task's Status, say):
   * hides the clear button and makes re-picking the current option a no-op
   * rather than emptying the field.
   */
  clearable?: boolean;
}

/**
 * Multi-select dropdown with an integrated search field. The trigger shows
 * "All projects" when empty, the single label when one is selected, or
 * "<first> +N" when multiple are.
 *
 * The panel stays open while picking, so several items can be toggled — and
 * carries a **Done** row so there's a visible way out that isn't "click some
 * empty part of the page". It also closes when focus leaves it, when another
 * dropdown opens, on Escape, and on a second click of the trigger.
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
        <>
          <SearchablePanel
            options={options}
            searchPlaceholder={searchPlaceholder}
            indicator="checkbox"
            isSelected={(v) => selectedSet.has(v)}
            onToggle={(v) => {
              if (selectedSet.has(v)) onChange(selected.filter((x) => x !== v));
              else onChange([...selected, v]);
              // Deliberately does NOT close — the point of a multi-select is
              // ticking several. Which is exactly why it needs the Done row
              // below: without a visible way out, the only exit was clicking
              // some empty part of the page.
            }}
          />
          <div className="flex justify-end border-t border-border px-2 py-1.5">
            <button
              type="button"
              onClick={close}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-surface-2"
            >
              Done
            </button>
          </div>
        </>
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
  clearable = true,
  disabled,
  ariaLabel,
  title,
}: SingleSelectProps) {
  const selectedOpt = options.find((o) => o.value === selected) ?? null;
  const summary = selectedOpt?.label ?? allLabel;

  return (
    <DropdownShell
      summary={summary}
      isEmpty={selectedOpt == null}
      disabled={disabled}
      ariaLabel={ariaLabel}
      title={title}
      onClear={selectedOpt && clearable && !disabled ? () => onChange(null) : undefined}
      renderPanel={({ close }) => (
        <SearchablePanel
          options={options}
          searchPlaceholder={searchPlaceholder}
          indicator="check"
          isSelected={(v) => v === selected}
          onToggle={(v) => {
            onChange(v === selected && clearable ? null : v);
            close();
          }}
        />
      )}
    />
  );
}

/**
 * A choice field with search, as a drop-in for a plain `<select>`.
 *
 * Every dropdown in a form should be searchable (Ray, 2026-08-03) — scanning
 * forty projects or a hundred parent tasks by eye is the slow way, and a user
 * shouldn't have to remember which dropdowns happen to have a search box. This
 * wrapper exists so converting one is a six-line swap rather than hand-mapping
 * the empty value each time:
 *
 *   - `""` (a plain select's empty `<option>`) maps to `null` and back, so
 *     callers keep the string state they already have.
 *   - `options` takes bare strings, since most of these come straight from a
 *     const array of SharePoint choices.
 *   - `clearable={false}` for a field that must always hold a value.
 */
export function ChoiceSelect({
  value,
  onChange,
  options,
  emptyLabel,
  searchPlaceholder,
  clearable = true,
  disabled,
  ariaLabel,
  title,
}: {
  value: string;
  onChange: (next: string) => void;
  options: readonly string[] | readonly SelectOption[];
  disabled?: boolean;
  /** Accessible name, when no <label> wraps this. */
  ariaLabel?: string;
  /** Tooltip on the control — see the note on SingleSelectProps.title. */
  title?: string;
  /** Trigger text when nothing is chosen — the old empty `<option>`'s label. */
  emptyLabel: string;
  searchPlaceholder?: string;
  clearable?: boolean;
}) {
  const opts: SelectOption[] = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );
  return (
    <SingleSelect
      options={opts}
      selected={value === "" ? null : value}
      onChange={(next) => onChange(next ?? "")}
      allLabel={emptyLabel}
      searchPlaceholder={searchPlaceholder}
      clearable={clearable}
      disabled={disabled}
      ariaLabel={ariaLabel}
      title={title}
    />
  );
}

interface DropdownShellProps {
  summary: string;
  isEmpty: boolean;
  disabled?: boolean;
  /** Tooltip, placed on the wrapper — see the note on SingleSelectProps.title. */
  title?: string;
  /**
   * Accessible name for the trigger. Most of these sit inside a <label>, which
   * names the button for free — but a control that labels itself (the Yes/No
   * radio group beside it can't live in a label) needs this instead, or the
   * button is announced as just its current value.
   */
  ariaLabel?: string;
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
  disabled,
  title,
  ariaLabel,
  onClear,
  renderPanel,
  chips,
  onRemoveChip,
}: DropdownShellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const useChips = chips !== undefined && chips.length > 0;

  // Stable so the close rules aren't torn down and rebuilt on every render.
  const close = useCallback(() => setOpen(false), []);
  useDropdownClose(open, ref, close);

  return (
    // onBlur is focusout and bubbles, so this catches focus leaving the
    // trigger, the search box or an option — see useDropdownClose.
    <div
      ref={ref}
      className="relative"
      title={title}
      onBlur={dropdownBlurHandler(ref, close)}
      // Escape closes the panel WITHOUT reaching an enclosing modal — see
      // dropdownKeyHandler.
      onKeyDown={dropdownKeyHandler(open, close)}
    >
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
          disabled={disabled}
          className="select flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={ariaLabel}
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
  /**
   * What the per-row selection indicator looks like.
   * - "checkbox": a tickable box — the multi-select affordance, since the panel
   *   stays open and several rows can be ticked at once.
   * - "check": a bare check mark on the current row only. A single-select
   *   replaces the previous choice and closes, so a box would promise
   *   "tick several" and be a lie. Unselected rows still reserve the
   *   indicator's width so the labels line up down the list.
   */
  indicator: "checkbox" | "check";
  isSelected: (value: string) => boolean;
  onToggle: (value: string) => void;
}

function SearchablePanel({
  options,
  searchPlaceholder,
  indicator,
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
    const q = query.trim();
    if (!q) return ordered;
    // Every word has to match, in any order — so "Jerrod W" finds
    // "Waldron, Jerrod" and "Sarah Shaffer" alike. A plain substring test
    // failed the moment the user typed a space.
    //
    // People options carry the person's email as their `value`; matching it
    // too means typing an address (or the part before the @) finds them.
    // Options keyed by a numeric id are NOT matched on value — "5" would
    // otherwise pull in every project whose id contains a 5.
    return ordered.filter((o) =>
      matchesTokens(o.value.includes("@") ? `${o.label} ${o.value}` : o.label, q),
    );
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
                {indicator === "checkbox" ? (
                  <span
                    data-indicator="checkbox"
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      selected
                        ? "border-accent bg-accent text-white"
                        : "border-border bg-surface",
                    )}
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                ) : (
                  <span
                    data-indicator="check"
                    className="flex h-4 w-4 shrink-0 items-center justify-center text-accent"
                  >
                    {selected && <Check className="h-4 w-4" />}
                  </span>
                )}
                <span className={cn("truncate", selected && "font-medium")}>{o.label}</span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
