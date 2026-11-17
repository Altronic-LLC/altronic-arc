import { useMemo, useState } from "react";
import { ShieldCheck, Trash2, UserPlus } from "lucide-react";
import {
  useCreateHrRoleEntry,
  useDeleteHrRoleEntry,
  useHrRoleEntries,
  useUpdateHrRoleEntry,
} from "@/hooks/useHrRoles";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Person } from "@/types/task";
import { HR_ROLES, HR_ROLE_HINTS, HR_ROLE_LABELS, type HrRole, type HrRoleEntry } from "@/types/hr";
import { mergePeople } from "@/lib/people";
import { LoadingTasks } from "@/components/LoadingTasks";
import { HrAccessGate, HrCardTitle, HrNav, HrPersonPicker } from "@/components/hrAtoms";

// =============================================================================
// HR Access (/hr/access) — who sees which HR app. Inside the HR department,
// not under /admin: the people who manage it are HR admins, with an ARC admin
// as the backstop so the list can never be locked from the inside.
//
// One tag per app, so somebody can have New Hire and not the next HR app.
// Somebody with no tag doesn't see HR at all. Names go in HERE, never in
// ARC's code — the repo is public. Every write asks the manage gate again
// inside its mutationFn.
// =============================================================================

export function HrAccessView() {
  return (
    <HrAccessGate app="manage">
      <HrAccess />
    </HrAccessGate>
  );
}

function usePeople(): Person[] {
  const directory = useDirectoryPeople();
  const me = useCurrentUser();
  return useMemo(() => mergePeople(directory, [me]), [directory, me]);
}

function HrAccess() {
  const { data: entries = [], isLoading, error, refetch } = useHrRoleEntries();
  const people = usePeople();
  const create = useCreateHrRoleEntry();
  const update = useUpdateHrRoleEntry();
  const remove = useDeleteHrRoleEntry();
  const [adding, setAdding] = useState<Person | null>(null);
  const [newRoles, setNewRoles] = useState<HrRole[]>(["new hire"]);

  const sorted = [...entries].sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));

  function toggleRole(entry: HrRoleEntry, role: HrRole) {
    const roles = entry.roles.includes(role) ? entry.roles.filter((r) => r !== role) : [...entry.roles, role];
    update.mutate({ id: entry.id, roles });
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">HR Access</h1>
          <p className="text-sm text-fg-muted">Who can see each Human Resources app, and who is emailed about new hires.</p>
        </div>
      </header>
      <HrNav />

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <HrCardTitle>People</HrCardTitle>
        <ul className="mb-3 mt-1 space-y-0.5 text-xs text-fg-muted">
          {HR_ROLES.map((r) => (
            <li key={r}>
              <span className="font-medium text-fg">{HR_ROLE_LABELS[r]}</span> — {HR_ROLE_HINTS[r]}
            </li>
          ))}
          <li>Anyone not on this list doesn't see Human Resources at all. A change applies straight away.</li>
        </ul>

        <div className="mb-4 grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-2/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
          <HrPersonPicker value={adding} people={people} onChange={setAdding} ariaLabel="Person to add" emptyLabel="Pick a person to add…" />
          <div className="flex flex-wrap gap-3 text-sm">
            {HR_ROLES.map((role) => (
              <label key={role} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={newRoles.includes(role)}
                  onChange={() => setNewRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]))}
                  className="h-3.5 w-3.5 accent-cooper-red"
                />
                {HR_ROLE_LABELS[role]}
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
          <LoadingTasks noun="HR access" />
        ) : error ? (
          <div className="text-sm text-cooper-red">
            Couldn't load the HR Roles list: {error instanceof Error ? error.message : "unknown error"}{" "}
            <button type="button" onClick={() => void refetch()} className="font-medium underline">
              Try again
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-fg-muted">Nobody yet — until somebody is added, nobody sees Human Resources.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <th className="py-1.5 pr-3">Person</th>
                  {HR_ROLES.map((r) => (
                    <th key={r} className="px-2 py-1.5 text-center" title={HR_ROLE_HINTS[r]}>
                      {HR_ROLE_LABELS[r]}
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
                    {HR_ROLES.map((role) => (
                      <td key={role} className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${entry.displayName || entry.email}: ${HR_ROLE_LABELS[role]}`}
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
                          if (window.confirm(`Remove ${entry.displayName || entry.email} from HR access?`)) remove.mutate(entry.id);
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
    </div>
  );
}
