import { Link } from "react-router-dom";
import type { ComponentDescriptionOption } from "@/types/task";
import { ChoicePills, MAX_PILL_OPTIONS } from "./ChoicePills";
import { ChoiceSelect } from "./SearchableSelect";
import {
  composeDescription,
  optionsOfKind,
  typesFor,
  type DescriptionPicks,
} from "@/lib/componentDescriptions";

// =============================================================================
// A new component's Description, picked rather than typed — the old Power
// App's two dropdowns (Tim, 2026-09-28), with a SIL category in front on the
// 722 list (2026-09-29). Type stays disabled until a Description is picked,
// and offers only that Description's types. What it saves as is shown under
// the dropdowns, so nobody is surprised by the capitals.
//
// The options come from the Component Description Options list; the SAP
// admin and the reviewing engineers manage it (the link below).
// =============================================================================

export function ComponentDescriptionPicker({
  picks,
  onChange,
  options,
  needSil,
  disabled,
}: {
  picks: DescriptionPicks;
  onChange: (next: DescriptionPicks) => void;
  options: readonly ComponentDescriptionOption[];
  /** The 722 list — a SIL category comes first. */
  needSil: boolean;
  disabled?: boolean;
}) {
  const sil = optionsOfKind(options, "SIL Category").map((o) => o.name);
  const descriptions = optionsOfKind(options, "Description").map((o) => o.name);
  const types = typesFor(options, picks.name);
  const showSil = needSil && sil.length > 0;
  const saved = composeDescription(picks);

  return (
    <div className="sm:col-span-2">
      <div className={showSil ? "grid grid-cols-1 gap-4 sm:grid-cols-3" : "grid grid-cols-1 gap-4 sm:grid-cols-2"}>
        {showSil && (
          <div>
            <FieldLabel text="SIL category" required />
            {sil.length <= MAX_PILL_OPTIONS ? (
              <ChoicePills
                label="SIL category"
                name="new-part-sil-category"
                options={sil}
                value={picks.silCategory}
                onChange={(v) => onChange({ ...picks, silCategory: v })}
                disabled={disabled}
              />
            ) : (
              <ChoiceSelect
                ariaLabel="SIL category"
                emptyLabel="Pick a SIL category"
                options={sil}
                value={picks.silCategory}
                onChange={(v) => onChange({ ...picks, silCategory: v })}
                disabled={disabled}
              />
            )}
          </div>
        )}
        <div>
          <FieldLabel text="Description" required />
          <ChoiceSelect
            ariaLabel="Description"
            emptyLabel="Pick a description"
            searchPlaceholder="Search descriptions…"
            options={descriptions}
            value={picks.name}
            // A new Description's types are different ones: clear the old pick.
            onChange={(v) => onChange({ ...picks, name: v, type: "" })}
            disabled={disabled}
          />
        </div>
        <div>
          <FieldLabel text="Type" required={types.length > 0} />
          <ChoiceSelect
            ariaLabel="Type"
            emptyLabel={!picks.name ? "Pick a description first" : types.length === 0 ? "No types" : "Pick a type"}
            searchPlaceholder="Search types…"
            options={types}
            value={picks.type}
            onChange={(v) => onChange({ ...picks, type: v })}
            disabled={disabled || !picks.name || types.length === 0}
            title={!picks.name ? "Pick a description first — the types depend on it." : undefined}
          />
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-fg-muted">
        {saved ? (
          <>
            Saves as <span className="font-mono text-fg">{saved}</span>.{" "}
          </>
        ) : null}
        Missing an option? The SAP admin and the reviewing engineers manage{" "}
        <Link to="/engineering/parts/descriptions" className="text-accent hover:underline">
          the description lists
        </Link>
        .
      </p>
    </div>
  );
}

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
      {text}
      {required && <span className="ml-1 text-cooper-red">*</span>}
    </span>
  );
}
