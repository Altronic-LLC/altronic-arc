import { MultiSelect } from "@/components/SearchableSelect";
import { mergePeople, personKey } from "@/lib/people";
import type { Person } from "@/types/task";

interface PersonMultiFieldProps {
  /** Currently-selected people. Rendered as removable chips on the trigger. */
  value: Person[];
  /** Full directory of pickable people, listed inside the dropdown. */
  allPeople: Person[];
  /** Called on add OR remove with the toggled person — caller decides how to merge. */
  onToggle: (p: Person) => void;
  /** Trigger copy shown when `value` is empty. Defaults to "Unassigned". */
  emptyLabel?: string;
  /** Placeholder inside the dropdown's search box. */
  searchPlaceholder?: string;
}

/**
 * Person picker for detail-view fields (Assigned, Watchers).
 *
 * A type-to-filter dropdown rather than a flat list of every person: the
 * directory runs to 200+ names, which is unusable as a wall of chips. The
 * "chips" trigger variant keeps the selected people visible and individually
 * removable, the way these fields have always looked — matching the EIR
 * detail's Assigned field and the form modals' pickers.
 *
 * Props are per-person toggles rather than a whole-list `onChange` because
 * every caller writes back one person at a time; the diff against `value`
 * happens here.
 */
export function PersonMultiField({
  value,
  allPeople,
  onToggle,
  emptyLabel = "Unassigned",
  searchPlaceholder = "Search people…",
}: PersonMultiFieldProps) {
  // Anyone already selected has to appear in the options or their chip would
  // silently vanish — `allPeople` doesn't always cover the saved value.
  const options = mergePeople(allPeople, value);
  const selected = value.map(personKey);

  return (
    <MultiSelect
      variant="chips"
      allLabel={emptyLabel}
      searchPlaceholder={searchPlaceholder}
      options={options.map((p) => ({ value: personKey(p), label: p.displayName }))}
      selected={selected}
      onChange={(keys) => {
        const before = new Set(selected);
        const after = new Set(keys);
        const byKey = new Map(options.map((p) => [personKey(p), p]));
        // Symmetric difference — one entry for a normal add/remove, but a
        // clear-all sends several, so fire onToggle for each.
        for (const key of new Set([...before, ...after])) {
          if (before.has(key) === after.has(key)) continue;
          const person = byKey.get(key);
          if (person) onToggle(person);
        }
      }}
    />
  );
}
