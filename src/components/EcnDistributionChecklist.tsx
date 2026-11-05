import type { EcnDistributionGroup } from "@/types/task";
import { distributionRoleOptions, toggleDistributionRole } from "@/lib/ecnDistribution";

// =============================================================================
// The ECN form's DISTRIBUTION block as tick boxes (BusinessIT#57) — shared by
// New ECN and the Distribution card's editor, so both offer the same roles in
// the same order. A checklist rather than pills: several are ticked at once,
// the way the paper form is marked.
//
// When the groups are loaded, each role says who it reaches, so ticking one is
// a decision about people rather than a label.
// =============================================================================

export function EcnDistributionChecklist({
  ticked,
  onChange,
  groups,
  disabled,
  idPrefix,
}: {
  ticked: string[];
  onChange: (next: string[]) => void;
  /** Omitted or empty = don't say who each role reaches. */
  groups?: EcnDistributionGroup[];
  disabled?: boolean;
  /** Keeps checkbox ids unique when two lists are on one page. */
  idPrefix: string;
}) {
  const options = distributionRoleOptions(ticked);
  return (
    <fieldset className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2" disabled={disabled}>
      <legend className="sr-only">Distribution</legend>
      {options.map((role) => {
        const id = `${idPrefix}-${role.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
        const on = ticked.some((r) => r.toLowerCase() === role.toLowerCase());
        const group = groups?.find((g) => g.role.toLowerCase() === role.toLowerCase());
        const names = group?.members.map((m) => m.displayName || m.email).filter(Boolean) ?? [];
        return (
          <label key={role} htmlFor={id} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 hover:bg-surface-2">
            <input
              id={id}
              type="checkbox"
              checked={on}
              onChange={() => onChange(toggleDistributionRole(ticked, role))}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-sm text-fg">{role}</span>
              {groups && groups.length > 0 && (
                <span className={`block truncate text-[11px] ${names.length ? "text-fg-muted" : "italic text-fg-muted"}`}>
                  {names.length ? names.join(", ") : "Nobody set up yet"}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
