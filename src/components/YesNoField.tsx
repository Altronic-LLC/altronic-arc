import { cn } from "@/lib/cn";

// =============================================================================
// A Yes / No column, as two labelled choices.
//
// These are real SharePoint boolean columns ("Field Returns Impacted",
// "Drawings Complete?"), and they used to render as a bare checkbox with the
// current state spelled out beside it. That reads as ambiguous — a tick you
// have to interpret, and no visible "No" to choose (Ray, 2026-08-19: "the Yes
// and No fields are confusing; they should display their labels clearly so you
// can select Yes or No").
//
// Two radios say what both options are and which one is picked, so the answer
// is readable without touching anything.
//
// The value is carried as "Yes" / "" rather than a boolean so it can live in
// the same string-keyed `values` record as every other column; the mapper
// turns it back into a real boolean on write.
// =============================================================================

export const YES = "Yes";

export function YesNoField({
  label,
  value,
  onChange,
  disabled,
  /** Distinguishes the two radios when several of these share a page. */
  name,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  name: string;
}) {
  const yes = value === YES;
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5 py-0.5">
      <Option
        label="Yes"
        name={name}
        checked={yes}
        disabled={disabled}
        onSelect={() => onChange(YES)}
      />
      <Option
        label="No"
        name={name}
        checked={!yes}
        disabled={disabled}
        onSelect={() => onChange("")}
      />
    </div>
  );
}

function Option({
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
