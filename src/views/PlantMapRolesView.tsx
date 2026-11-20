import { useMemo, useState } from "react";
import { Trash2, UserPlus, Users } from "lucide-react";
import {
  useCreatePlantMapRoleEntry,
  useDeletePlantMapRoleEntry,
  useMyPlantMapAccess,
  usePlantMapRoleEntries,
  useUpdatePlantMapRoleEntry,
} from "@/hooks/usePlantMapRoles";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Person } from "@/types/task";
import { PLANT_MAP_ROLES, PLANT_MAP_ROLE_LABELS, type PlantMapRole, type PlantMapRoleEntry } from "@/types/plant";
import { managePlantMapRolesGate } from "@/lib/plantMapRoles";
import { mergePeople, personKey } from "@/lib/people";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SingleSelect } from "@/components/SearchableSelect";
import { PlantCardTitle, PlantMapAccessGate, PlantMapNav } from "@/components/plantMapAtoms";

// =============================================================================
// Plant Map → Roles — inside the section, not under /admin: the people who
// manage it are the Plant Map admins, with an ARC admin as the backstop.
//
// Reading the screen needs the manage right; every write asks it again inside
// its mutationFn. Names go in HERE, never in ARC's code — the repo is public.
// =============================================================================

export function PlantMapRolesView() {
  return (
    <PlantMapAccessGate roleManagers>
      <PlantMapRoles />
    </PlantMapAccessGate>
  );
}

function PlantMapRoles() {
  const gate = managePlantMapRolesGate(useMyPlantMapAccess());
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
          <Users className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Plant Map Roles</h1>
          <p className="text-sm text-fg-muted">Who may draw and publish the plant's layouts.</p>
        </div>
      </header>
      <PlantMapNav />
      {gate.resolving ? (
        <LoadingTasks noun="Plant Map roles" />
      ) : !gate.allowed ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">{gate.hint}</p>
      ) : (
        <RolesCard />
      )}
    </div>
  );
}

function usePeople(): Person[] {
  const directory = useDirectoryPeople();
  const me = useCurrentUser();
  return useMemo(() => mergePeople(directory, [me]), [directory, me]);
}

function RolesCard() {
  const { data: entries = [], isLoading, error } = usePlantMapRoleEntries();
  const people = usePeople();
  const create = useCreatePlantMapRoleEntry();
  const update = useUpdatePlantMapRoleEntry();
  const remove = useDeletePlantMapRoleEntry();
  const [adding, setAdding] = useState<Person | null>(null);
  const [newRoles, setNewRoles] = useState<PlantMapRole[]>(["editor"]);

  const sorted = [...entries].sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
  const options = people
    .filter((p) => p.email)
    .map((p) => ({ value: personKey(p), label: p.displayName || p.email! }));

  function toggleRole(entry: PlantMapRoleEntry, role: PlantMapRole) {
    const roles = entry.roles.includes(role) ? entry.roles.filter((r) => r !== role) : [...entry.roles, role];
    update.mutate({ id: entry.id, roles });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-1">
        <PlantCardTitle>People</PlantCardTitle>
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        Editors start layouts and edit drafts. Plant Map admins also publish layouts, manage the symbol library and this
        page. Everyone signed in can view the plant map once it's live. A change applies the next time a button is pressed.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-2/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <SingleSelect
          options={options}
          selected={adding ? personKey(adding) : null}
          onChange={(key) => setAdding(key ? (people.find((p) => personKey(p) === key) ?? null) : null)}
          allLabel="Pick a person to add…"
          ariaLabel="Person to add"
          searchPlaceholder="Search people…"
        />
        <div className="flex flex-wrap gap-3 text-sm">
          {PLANT_MAP_ROLES.map((role) => (
            <label key={role} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={newRoles.includes(role)}
                onChange={() => setNewRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]))}
                className="h-3.5 w-3.5 accent-cooper-red"
              />
              {PLANT_MAP_ROLE_LABELS[role]}
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={!adding?.email || newRoles.length === 0 || create.isPending}
          onClick={() =>
            adding?.email &&
            create.mutate(
              { email: adding.email, displayName: adding.displayName, roles: newRoles, note: "" },
              { onSuccess: () => setAdding(null) },
            )
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          Add
        </button>
      </div>

      {isLoading ? (
        <LoadingTasks noun="the roles list" />
      ) : error ? (
        <p className="text-sm text-cooper-red">
          Couldn't load the Plant Map Roles list: {error instanceof Error ? error.message : "unknown error"}
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-fg-muted">Nobody yet — until somebody is added, nobody can start or edit a layout.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="py-1.5 pr-3">Person</th>
                {PLANT_MAP_ROLES.map((r) => (
                  <th key={r} className="px-2 py-1.5 text-center">
                    {PLANT_MAP_ROLE_LABELS[r]}
                  </th>
                ))}
                <th className="py-1.5" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    <span className="block text-fg">{entry.displayName || entry.email}</span>
                    <span className="block text-xs text-fg-muted">{entry.email}</span>
                  </td>
                  {PLANT_MAP_ROLES.map((role) => (
                    <td key={role} className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${entry.displayName || entry.email}: ${PLANT_MAP_ROLE_LABELS[role]}`}
                        checked={entry.roles.includes(role)}
                        onChange={() => toggleRole(entry, role)}
                        className="h-4 w-4 accent-cooper-red"
                      />
                    </td>
                  ))}
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      aria-label={`Remove ${entry.displayName || entry.email}`}
                      onClick={() => {
                        if (window.confirm(`Remove ${entry.displayName || entry.email} from the Plant Map Roles list?`)) {
                          remove.mutate(entry.id);
                        }
                      }}
                      className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-cooper-red"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
