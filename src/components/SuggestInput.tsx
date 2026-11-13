import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { dropdownBlurHandler, useDropdownClose } from "./useDropdownClose";

// =============================================================================
// A text field that behaves like a choice field.
//
// For SharePoint TEXT columns that people treat as a fixed set — initials, the
// CAD software used — where the set isn't actually fixed. Typing a new value is
// allowed, and because the options are derived from what's already stored, that
// value becomes one of the suggestions next time. The list maintains itself; no
// admin screen, and no SharePoint choice column to keep in step.
//
// Deliberately NOT SearchableSelect: that one only lets you choose from a given
// list. Here the input IS the value, and the dropdown is assistance.
// =============================================================================

interface SuggestInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Values already in use, most-used first. Shown as suggestions. */
  options: string[];
  /**
   * A bigger list searched ONLY once the person types — never shown just for
   * opening the box. The coating check's Machine box opens on the machines
   * already used, and typing also finds anything on the equipment register
   * (Tim, 2026-11-04: "it should just be a small list"). Optional; every
   * other caller passes nothing and behaves as before.
   */
  searchOptions?: string[];
  placeholder?: string;
  disabled?: boolean;
  /** Accessible name, when there's no visible <label> wrapping this. */
  ariaLabel?: string;
}

export function SuggestInput({
  value,
  onChange,
  options,
  searchOptions,
  placeholder,
  disabled,
  ariaLabel,
}: SuggestInputProps) {
  const [open, setOpen] = useState(false);
  // Has the person typed since the list opened? Until they do, the WHOLE list
  // shows. Filtering on a value the field merely started with — a name filled
  // in for you, a value on an edit — left the list empty, so the box looked
  // dead (Tim, 2026-11-04, the coating check's Operator and Machine).
  const [typed, setTyped] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const openList = useCallback(() => {
    setTyped(false);
    setOpen(true);
  }, []);

  // Same close rules as every other dropdown: focus leaving, another dropdown
  // opening, an outside click, Escape. See useDropdownClose.
  const close = useCallback(() => setOpen(false), []);
  useDropdownClose(open, wrapRef, close);

  // Filter as you type, but keep every option available once the field matches
  // one exactly — otherwise picking a value collapses the list to just itself
  // and you can't change your mind without clearing the box. Before any typing
  // (just opened), everything shows. Typing also searches `searchOptions`,
  // after the matching `options`.
  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q || !typed) return options;
    const exact = options.some((o) => o.toLowerCase() === q);
    if (exact) return options;
    const inOptions = new Set(options.map((o) => o.toLowerCase()));
    const searched = (searchOptions ?? []).filter((o) => !inOptions.has(o.toLowerCase()));
    return [...options, ...searched].filter((o) => o.toLowerCase().includes(q));
  }, [options, searchOptions, value, typed]);

  // Not "new" if it's on either list — a machine from the register isn't a typo.
  const known = (o: string) => o.toLowerCase() === value.trim().toLowerCase();
  const isNew = value.trim() !== "" && !options.some(known) && !(searchOptions ?? []).some(known);

  return (
    <div
      className="relative"
      ref={wrapRef}
      // Escape on the WRAPPER, not the input: focus may be on the chevron or a
      // suggestion when someone reaches for it. (useDropdownClose also listens
      // on the document; this one stops the key reaching an enclosing modal,
      // which would otherwise close the whole dialog.)
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
      onBlur={dropdownBlurHandler(wrapRef, close)}
    >
      <div className="flex">
        <input
          type="text"
          value={value}
          aria-label={ariaLabel}
          onChange={(e) => {
            onChange(e.target.value);
            setTyped(true);
            if (!open) setOpen(true);
          }}
          onFocus={openList}
          placeholder={placeholder}
          disabled={disabled}
          className="select flex-1 rounded-r-none"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openList())}
          disabled={disabled || options.length === 0}
          aria-label="Show existing values"
          aria-expanded={open}
          className="flex items-center rounded-r-md border border-l-0 border-border bg-surface-2 px-2 text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {/* A quiet note that this value isn't one of the existing ones. Not an
          error — new values are the point — but worth seeing before saving a
          typo that then becomes a suggestion for everyone else. */}
      {isNew && options.length > 0 && (
        <p className="mt-1 text-[11px] text-fg-muted">
          New value — it'll appear as a suggestion once saved.
        </p>
      )}

      {open && shown.length > 0 && (
        <ul
          role="listbox"
          className="scroll-elegant absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-xl"
        >
          {shown.map((option) => (
            <li key={option}>
              <button
                type="button"
                role="option"
                aria-selected={option === value}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-2",
                  option === value ? "font-medium text-fg" : "text-fg-muted",
                )}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Distinct values of one field across the loaded rows, most-used first.
 *
 * Frequency order rather than alphabetical: the initials of whoever draws most of
 * the drawings should be the first thing offered, not whoever happens to sort
 * first.
 */
export function distinctValues(values: Array<string | null | undefined>): string[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}
