import type { Person, ProjectReference } from "@/types/task";
import { MAINTENANCE_CATEGORIES } from "@/types/task";
import { personKey } from "@/lib/people";
import {
  UNASSIGNED_FILTER_KEY,
  normalizeMaintenanceTypeFilter,
  type MaintenanceFilters,
} from "@/lib/maintenanceFilters";
// The Type axis' options live with the calendar, which has had this filter
// since it shipped. Imported, not re-listed: one spelling, one set of labels,
// so the two screens read the same.
import { MAINTENANCE_TYPE_OPTIONS } from "@/lib/maintenanceCalendar";
import { referenceKey, referenceLabel } from "@/lib/maintenanceReferences";
import { ChoicePills } from "./ChoicePills";
import { MultiSelect } from "./SearchableSelect";
import { SearchInput } from "./SearchInput";

// =============================================================================
// The filter bar above BOTH work-order views.
//
// One component, not one per view, for the reason `EirFilterBar` is shared by
// the EIR list and board: the list and the board are two renderings of one
// filtered set, and a second copy is how a fix reaches only one of them.
//
// Every DROPDOWN here is a searchable MultiSelect — never a native <select>
// (CLAUDE.md, "Every dropdown in a form is searchable"). The asset picker in
// particular: a shop with 378 machines is not scannable by eye.
//
// **Type is three options, so it is pills rather than a dropdown** (CLAUDE.md,
// "A short choice list is pills"), matching the calendar's own Type control
// exactly — same options, same labels, same param, so the two screens read the
// same.
// =============================================================================

interface MaintenanceFilterBarProps {
  filters: MaintenanceFilters;
  onChange: (next: MaintenanceFilters) => void;
  /** Assets that actually carry work orders — see collectMaintenanceEquipment. */
  equipment: ProjectReference[];
  /** People who appear on any work order, plus the signed-in user. */
  people: Person[];
  /**
   * Departments present in the register or on a work order — see
   * `maintenanceDepartmentOptions`. A LOOKUP since 2026-08-28, so the option's
   * value is its `referenceKey` (the lookupId) and only the label is the name:
   * a renamed department keeps every filtered link that points at it.
   */
  departments: ProjectReference[];
}

export function MaintenanceFilterBar({
  filters,
  onChange,
  equipment,
  people,
  departments,
}: MaintenanceFilterBarProps) {
  const peopleSorted = [...people].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const peopleOptions = [
    // "Unassigned" leads, because on a shop floor the jobs nobody has picked
    // up are the ones somebody is looking for.
    { value: UNASSIGNED_FILTER_KEY, label: "Unassigned" },
    // personKey so an option's value matches what applyMaintenanceFilters
    // compares against — a raw email drifts in case between SharePoint and MSAL.
    ...peopleSorted.map((p) => ({ value: personKey(p), label: p.displayName })),
  ];

  return (
    <div role="search" aria-label="Work order filters" className="flex flex-col gap-3">
      {/*
        Its own row rather than a sixth cell in the grid below: pills wrap into
        an unreadable block in a column sized for a dropdown, and Type is the
        coarsest cut of the queue — scheduled PM work, or the jobs somebody
        raised because something broke.

        NOT wrapped in a <label>, unlike every Field below: a pill group
        carries its own labels, which would nest and steal the click
        (CLAUDE.md, "A pill group can't sit inside a <label>").
      */}
      <div>
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Type
        </span>
        <ChoicePills
          label="Type"
          name="maintenance-work-order-type"
          options={MAINTENANCE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={filters.type}
          // Both is a real option carrying `""` rather than `allowUnset` — the
          // same shape as the calendar's. Normalised on the way back so the
          // filter shape stays typed whatever a caller hands over.
          onChange={(v) => onChange({ ...filters, type: normalizeMaintenanceTypeFilter(v) })}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
        <Field label="Equipment">
          <MultiSelect
            allLabel="All equipment"
            searchPlaceholder="Search assets…"
            options={equipment.map((e) => ({
              value: String(e.lookupId),
              label: e.title || `Asset #${e.lookupId}`,
            }))}
            selected={filters.equipmentIds.map(String)}
            onChange={(next) =>
              onChange({
                ...filters,
                equipmentIds: next.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)),
              })
            }
          />
        </Field>

        <Field label="Assigned">
          <MultiSelect
            allLabel="Anyone"
            searchPlaceholder="Search people…"
            options={peopleOptions}
            selected={filters.assignedEmails}
            onChange={(next) => onChange({ ...filters, assignedEmails: next })}
          />
        </Field>

        <Field label="Category">
          <MultiSelect
            allLabel="All categories"
            searchPlaceholder="Search categories…"
            options={MAINTENANCE_CATEGORIES.map((c) => ({ value: c, label: c }))}
            selected={filters.categories}
            onChange={(next) => onChange({ ...filters, categories: next })}
          />
        </Field>

        <Field label="Department">
          <MultiSelect
            allLabel="All departments"
            searchPlaceholder="Search departments…"
            options={departments.map((d) => ({
              value: referenceKey(d),
              // Never "": a department that IS on a work order must be
              // selectable by something a person can read.
              label: referenceLabel(d),
            }))}
            selected={filters.departments}
            onChange={(next) => onChange({ ...filters, departments: next })}
          />
        </Field>

        <Field label="Search">
          <SearchInput
            value={filters.search}
            onChange={(search) => onChange({ ...filters, search })}
            placeholder="WO number, asset, fault — add words to narrow"
            className="select"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
