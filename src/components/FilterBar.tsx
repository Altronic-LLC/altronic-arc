import {
  CATEGORIES,
  OPERATIONS_TASK_TYPES,
  type Person,
  type ProjectReference,
} from "@/types/task";
import { cn } from "@/lib/cn";
import { personKey } from "@/lib/people";
import { MultiSelect, SingleSelect } from "./SearchableSelect";
import { SearchInput } from "./SearchInput";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export interface Filters {
  search: string;
  /** Selected project lookup IDs. Empty array = all projects. */
  projectIds: number[];
  /** Selected assignee emails (or displayNames as a fallback). Empty = anyone. */
  assignedEmails: string[];
  createdByEmail: string | null;
  /**
   * Show only tasks this person WATCHES. Null = don't filter on watchers.
   *
   * The old task app had this and it was missed (Ray, 2026-09-16): without it
   * the only ways to find something you're tracking but not assigned to are
   * remembering it or waiting for an email. Deliberately a SINGLE person
   * rather than a multi-select — "what am I watching" is the question, and a
   * set of watchers ORed together answers nobody's.
   */
  watchedByEmail: string | null;
  /**
   * Selected categories — the Engineering task's Category, or the Operations
   * task's Task Type. Empty = any. Altronic-LLC/BusinessIT#76 (Brandon
   * Mirto): searching "label" finds every task that MENTIONS a label, when
   * the question is "which tasks are label changes". A task with no category
   * never matches a selection.
   */
  categories: string[];
}

export const EMPTY_FILTERS: Filters = {
  search: "",
  projectIds: [],
  assignedEmails: [],
  createdByEmail: null,
  watchedByEmail: null,
  categories: [],
};

/** The Category control: what the list calls the column, and its choices. */
export interface CategoryFilterSpec {
  label: string;
  options: readonly string[];
}

/** Engineering tasks' Category (the List and the board). */
export const TASK_CATEGORY_FILTER: CategoryFilterSpec = { label: "Category", options: CATEGORIES };

/** Operations tasks' Task Type — that list's Category. */
export const OPERATIONS_TASK_TYPE_FILTER: CategoryFilterSpec = {
  label: "Task Type",
  options: OPERATIONS_TASK_TYPES,
};

interface FilterBarProps {
  filters: Filters;
  onChange: (f: Filters) => void;
  projects: ProjectReference[];
  people: Person[]; // deduplicated set of people who appear on any task
  /**
   * Rendered IN PLACE of the Project Reference control. The Operations list's
   * "All tasks" scope spans two lists whose project ids mean different
   * projects, so it swaps Project for a Department filter rather than offering
   * a control that can't be right for both halves.
   */
  replaceProjectWith?: { label: string; control: React.ReactNode };
  /**
   * Offer a Category filter. Engineering passes Category, Operations its Task
   * Type. Left out in the "All tasks" scope, where the two lists' choices
   * differ — `filterCombinedTasks` ignores the filter there too, so a
   * `category=` left in the URL can't narrow the list invisibly.
   */
  category?: CategoryFilterSpec;
}

export function FilterBar({
  filters,
  onChange,
  projects,
  people,
  replaceProjectWith,
  category,
}: FilterBarProps) {
  const me = useCurrentUser();
  const peopleSorted = [...people].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const peopleOptions = peopleSorted.map((p) => ({
    // personKey so an option's value matches what applyFilters compares
    // against — a raw email drifts in case between SharePoint and MSAL.
    value: personKey(p),
    label: p.displayName,
  }));

  // The same people, with the signed-in user pinned first and labelled — the
  // common case for "Watching" is your own list, and hunting for your own
  // name in a 200-person dropdown to answer it is the thing this filter
  // exists to avoid.
  const meKey = me.email ? me.email.toLowerCase() : null;
  const watchingOptions = meKey
    ? [
        { value: meKey, label: `Me (${me.displayName})` },
        ...peopleOptions.filter((o) => o.value !== meKey),
      ]
    : peopleOptions;

  return (
    // One row at the widest breakpoint, however many controls there are — a
    // last field alone on a second row reads as an afterthought. Six with a
    // Category filter, five without. The md:2 / lg:3 steps are unchanged.
    <div
      className={cn(
        "grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3",
        category ? "xl:grid-cols-6" : "xl:grid-cols-5",
      )}
    >
      {replaceProjectWith ? (
        <Field label={replaceProjectWith.label}>{replaceProjectWith.control}</Field>
      ) : (
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
      )}

      {category && (
        <Field label={category.label}>
          <MultiSelect
            allLabel="Any"
            searchPlaceholder={`Search ${category.label.toLowerCase()}…`}
            options={category.options.map((c) => ({ value: c, label: c }))}
            selected={filters.categories}
            onChange={(next) => onChange({ ...filters, categories: next })}
          />
        </Field>
      )}

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
        <SearchInput
          value={filters.search}
          onChange={(search) => onChange({ ...filters, search })}
          placeholder="Search anything — add words to narrow"
          className="select"
        />
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

      {/*
        Watching — how you find something you're tracking but aren't assigned
        to. "Me" is pinned to the top because that is the question people
        actually ask; picking somebody else answers "what is Sarah tracking".
      */}
      <Field label="Watching">
        <SingleSelect
          allLabel="Anyone"
          searchPlaceholder="Search people…"
          options={watchingOptions}
          selected={filters.watchedByEmail}
          onChange={(next) => onChange({ ...filters, watchedByEmail: next })}
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
