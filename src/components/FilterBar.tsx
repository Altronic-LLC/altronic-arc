import { Search } from "lucide-react";
import type { Person, ProjectReference } from "@/types/task";
import { MultiSelect, SingleSelect } from "./SearchableSelect";

export interface Filters {
  search: string;
  /** Selected project lookup IDs. Empty array = all projects. */
  projectIds: number[];
  /** Selected assignee emails (or displayNames as a fallback). Empty = anyone. */
  assignedEmails: string[];
  createdByEmail: string | null;
}

export const EMPTY_FILTERS: Filters = {
  search: "",
  projectIds: [],
  assignedEmails: [],
  createdByEmail: null,
};

interface FilterBarProps {
  filters: Filters;
  onChange: (f: Filters) => void;
  projects: ProjectReference[];
  people: Person[]; // deduplicated set of people who appear on any task
}

export function FilterBar({ filters, onChange, projects, people }: FilterBarProps) {
  const peopleSorted = [...people].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const peopleOptions = peopleSorted.map((p) => ({
    value: p.email ?? p.displayName,
    label: p.displayName,
  }));

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      <Field label="Project Reference">
        <MultiSelect
          allLabel="All projects"
          searchPlaceholder="Search projects…"
          options={projects.map((p) => ({ value: String(p.lookupId), label: p.title }))}
          selected={filters.projectIds.map(String)}
          onChange={(next) =>
            onChange({
              ...filters,
              projectIds: next.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)),
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

      <Field label="Search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Title, description, comments…"
            className="select"
            style={{ paddingLeft: "2.25rem" }}
          />
        </div>
      </Field>

      <Field label="Created By">
        <SingleSelect
          allLabel="Anyone"
          searchPlaceholder="Search people…"
          options={peopleOptions}
          selected={filters.createdByEmail}
          onChange={(next) => onChange({ ...filters, createdByEmail: next })}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
