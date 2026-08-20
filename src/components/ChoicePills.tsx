import { cn } from "@/lib/cn";

// =============================================================================
// A small choice set, as pills you click — not a dropdown.
//
// Yes/No, Yes/Pending, Pass/Fail, In Process/Yes/No. Putting two or three
// options behind a dropdown costs a click to open, a read to find the option
// you already knew you wanted, and a second click to pick it — for a question
// whose whole answer fits on screen (Ray, 2026-08-19: "make sure all yes no
// are selections throughout the apps and modals. Easy to toggle.").
//
// Above three options this stops being the right control — the pills wrap into
// an unreadable block and a searchable dropdown wins. `MAX_PILL_OPTIONS` is
// where callers draw that line.
//
// `YesNoField` is the boolean-column wrapper over this; anything else with a
// short choice list should use it directly.
// =============================================================================

/** Past this many options, use a searchable dropdown instead. */
export const MAX_PILL_OPTIONS = 3;

export interface PillOption {
  value: string;
  label: string;
}

export function ChoicePills({
  label,
  options,
  value,
  onChange,
  disabled,
  /** Distinguishes these radios from every other group on the page. */
  name,
  /**
   * Offer a **Not set** pill.
   *
   * Needed for any column where blank is its own state rather than a synonym
   * for the negative option — which is most of them on these lists, since the
   * majority of rows have never been answered. Without it, opening a record
   * and saving would quietly answer a question nobody had answered.
   */
  allowUnset = false,
  unsetLabel = "Not set",
}: {
  label: string;
  options: readonly (string | PillOption)[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  name: string;
  allowUnset?: boolean;
  unsetLabel?: string;
}) {
  const opts: PillOption[] = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );
  const all = allowUnset ? [...opts, { value: "", label: unsetLabel }] : opts;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap items-center gap-1.5 py-0.5"
    >
      {all.map((option) => (
        <Pill
          key={option.value || "__unset__"}
          label={option.label}
          name={name}
          checked={value === option.value}
          disabled={disabled}
          onSelect={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

function Pill({
  label,
  name,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  name: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors",
        checked
          ? "border-accent bg-accent/10 font-medium text-fg"
          : "border-border bg-surface text-fg-muted hover:bg-surface-2",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="h-3.5 w-3.5 accent-cooper-red"
      />
      {label}
    </label>
  );
}
