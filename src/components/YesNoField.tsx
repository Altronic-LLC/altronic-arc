import { ChoicePills } from "./ChoicePills";

// =============================================================================
// A Yes / No column, as two labelled choices.
//
// These are real SharePoint boolean columns ("Field Returns Impacted",
// "Drawings Complete?", "Lead Free (RoHS)"), and they used to render as a bare
// checkbox with the current state spelled out beside it. That reads as
// ambiguous — a tick you have to interpret, and no visible "No" to choose
// (Ray, 2026-08-19: "the Yes and No fields are confusing; they should display
// their labels clearly so you can select Yes or No").
//
// A thin wrapper over ChoicePills, which is the same control every other short
// choice list uses. What it adds is the storage rule: the value is carried as
// "Yes" / "" rather than a boolean so it can live in the same string-keyed
// `values` record as every other column, and the mapper turns it back into a
// real boolean on write.
// =============================================================================

export const YES = "Yes";
export const NO = "No";

export function YesNoField({
  label,
  value,
  onChange,
  disabled,
  /** Distinguishes these radios from every other group on the page. */
  name,
  /**
   * How "No" is stored.
   *
   * - `"empty"` (default) — a real SharePoint **boolean** column, where the
   *   only two states are true and false. The mapper carries false as `""`.
   * - `"no"` — a **text or choice** column holding the literal words, where
   *   blank is a third state meaning nobody has answered yet. Pair it with
   *   `allowUnset` so that state stays reachable.
   */
  noValue = "empty",
  /**
   * Offer a third **Not set** option — for a column where blank is distinct
   * from No. See the note on ChoicePills.
   */
  allowUnset = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  name: string;
  noValue?: "empty" | "no";
  allowUnset?: boolean;
}) {
  // Stored casing varies on the text columns ("yes" appears in older rows), so
  // match loosely and write back the canonical form.
  const normalised = value.trim().toLowerCase();
  // `allowUnset` forces the literal "No": on a boolean column No IS blank, so
  // the two pills would share a value and both light up. A column that needs a
  // distinct "not answered" state is a text/choice column by definition.
  const noStored = noValue === "no" || allowUnset ? NO : "";
  const selected = normalised === "yes" ? YES : normalised === "no" ? noStored : value.trim();

  return (
    <ChoicePills
      label={label}
      name={name}
      disabled={disabled}
      allowUnset={allowUnset}
      options={[
        { value: YES, label: "Yes" },
        { value: noStored, label: "No" },
      ]}
      // A boolean column with no unset state reads blank as No.
      value={!allowUnset && selected !== YES ? noStored : selected}
      onChange={onChange}
    />
  );
}
