import { Search } from "lucide-react";
import type { Person, ProjectReference } from "@/types/task";

export interface Filters {
  search: string;
  projectId: number | null;
  assignedEmail: string | null;
  createdByEmail: string | null;
}

export const EMPTY_FILTERS: Filters = {
  search: "",
  projectId: null,
  assignedEmail: null,
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

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      <Field label="Project Reference">
        <select
          value={filters.projectId ?? ""}
          onChange={(e) =>
            onChange({
              ...filters,
              projectId: e.target.value ? parseInt(e.target.value, 10) : null,
            })
          }
          className="select"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.lookupId} value={p.lookupId}>
              {p.title}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Assigned">
        <select
          value={filters.assignedEmail ?? ""}
          onChange={(e) =>
            onChange({ ...filters, assignedEmail: e.target.value || null })
          }
          className="select"
        >
          <option value="">Anyone</option>
          {peopleSorted.map((p) => (
            <option key={p.email ?? p.displayName} value={p.email ?? p.displayName}>
              {p.displayName}
            </option>
          ))}
        </select>
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
        <select
          value={filters.createdByEmail ?? ""}
          onChange={(e) => onChange({ ...filters, createdByEmail: e.target.value || null })}
          className="select"
        >
          <option value="">Anyone</option>
          {peopleSorted.map((p) => (
            <option key={p.email ?? p.displayName} value={p.email ?? p.displayName}>
              {p.displayName}
            </option>
          ))}
        </select>
      </Field>

      <style>{`
        .select {
          width: 100%;
          height: 38px;
          padding: 0 0.75rem;
          background: rgb(var(--surface));
          color: rgb(var(--fg));
          border: 1px solid rgb(var(--border));
          border-radius: 8px;
          /* 16px on mobile prevents iOS Safari from auto-zooming when an
             input gets focus; smaller on tablet+ for visual density. */
          font-size: 16px;
          transition: border-color 120ms ease, box-shadow 120ms ease;
        }
        @media (min-width: 640px) {
          .select { font-size: 0.875rem; }
        }
        .select:focus {
          outline: none;
          border-color: rgb(var(--accent));
          box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
        }
      `}</style>
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
