import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/SearchInput";
import type { EirFilters } from "@/lib/eirFilters";
import type { Person, ProjectReference } from "@/types/task";

// =============================================================================
// The EIRs filter bar — Project Reference / Assigned Engineer / Search /
// Reporter. Shared by the EIRs list and the EIRs board so the two views
// filter identically; it was inline in EirsView before the board existed.
// =============================================================================

interface EirFilterBarProps {
  filters: EirFilters;
  projects: ProjectReference[];
  /** Everyone who appears on an EIR — see `collectEirPeople`. */
  people: Person[];
  onSearch: (v: string) => void;
  onProjectIds: (ids: number[]) => void;
  onReporter: (email: string | null) => void;
  onEngineers: (emails: string[]) => void;
}

export function EirFilterBar({
  filters,
  projects,
  people,
  onSearch,
  onProjectIds,
  onReporter,
  onEngineers,
}: EirFilterBarProps) {
  const personOptions = people.map((p) => ({
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
            onProjectIds(next.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)))
          }
        />
      </Field>
      <Field label="Assigned Engineer">
        <MultiSelect
          allLabel="Anyone"
          searchPlaceholder="Search people…"
          options={personOptions}
          selected={filters.engineerEmails}
          onChange={onEngineers}
        />
      </Field>
      <Field label="Search">
        <SearchInput
          value={filters.search}
          onChange={onSearch}
          placeholder="Search anything — add words to narrow"
          className="eir-filter-input"
        />
      </Field>
      <Field label="Reporter">
        <SingleSelect
          allLabel="Anyone"
          searchPlaceholder="Search people…"
          options={personOptions}
          selected={filters.reporterEmail}
          onChange={onReporter}
        />
      </Field>

      <style>{`
        .eir-filter-input {
          width: 100%;
          height: 38px;
          padding: 0 0.75rem;
          background: rgb(var(--surface));
          color: rgb(var(--fg));
          border: 1px solid rgb(var(--border));
          border-radius: 8px;
          font-size: 16px;
          transition: border-color 120ms ease, box-shadow 120ms ease;
        }
        @media (min-width: 640px) {
          .eir-filter-input { font-size: 0.875rem; }
        }
        .eir-filter-input:focus {
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
