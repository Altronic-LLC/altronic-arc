import { useMemo, useState } from "react";
import { Trash2, UserPlus, Users } from "lucide-react";
import {
  useCreateMcnRoleEntry,
  useDeleteMcnRoleEntry,
  useMcnDistributionGroups,
  useMcnRoleEntries,
  useMyMcnAccess,
  useSetMcnGroupMembers,
  useUpdateMcnRoleEntry,
} from "@/hooks/useMcnRoles";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Person } from "@/types/task";
import { MCN_ROLES, MCN_ROLE_LABELS, type McnRole, type McnRoleEntry } from "@/types/mcn";
import { manageMcnGate } from "@/lib/mcnRoles";
import { mergePeople, personKey } from "@/lib/people";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PersonMultiField } from "@/components/PersonMultiField";
import { CardTitle, McnAccessGate, McnNav } from "@/components/mcnAtoms";
import { McnPersonPicker } from "@/components/McnFields";

// =============================================================================
// MCN Settings — inside the MCN section, not under /admin (Dave, 2026-10-21):
// the people who manage it are the MCN admins, and an ARC admin as a backstop.
//
//   * The Manufacturing Team — who is a member (raises and edits), an
//     approver (approves, rejects, reopens) and an MCN admin (this screen).
//   * The eight distribution groups — who receives an approved MCN for each
//     Distribution box on MFGFRM-021.
//
// Reading the screen needs the manage right; every write asks it again inside
// its mutationFn. Names go in HERE, never in ARC's code — the repo is public.
// =============================================================================

export function McnSettingsView() {
  return (
    <McnAccessGate>
      <McnSettings />
    </McnAccessGate>
  );
}

function McnSettings() {
  const access = useMyMcnAccess();
  const gate = manageMcnGate(access);
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <Users className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">MCN Settings</h1>
          <p className="text-sm text-fg-muted">The Manufacturing Team, the approvers, and who each distribution goes to.</p>
        </div>
      </header>
      <McnNav />
      {gate.resolving ? (
        <LoadingTasks noun="MCN settings" />
      ) : !gate.allowed ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">{gate.hint}</p>
      ) : (
        <>
          <TeamCard />
          <GroupsCard />
        </>
      )}
    </div>
  );
}

function usePeople(): Person[] {
  const directory = useDirectoryPeople();
  const me = useCurrentUser();
  return useMemo(() => mergePeople(directory, [me]), [directory, me]);
}

function TeamCard() {
  const { data: entries = [], isLoading, error } = useMcnRoleEntries();
  const people = usePeople();
  const create = useCreateMcnRoleEntry();
  const update = useUpdateMcnRoleEntry();
  const remove = useDeleteMcnRoleEntry();
  const [adding, setAdding] = useState<Person | null>(null);
  const [newRoles, setNewRoles] = useState<McnRole[]>(["member"]);

  const sorted = [...entries].sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));

  function toggleRole(entry: McnRoleEntry, role: McnRole) {
    const roles = entry.roles.includes(role) ? entry.roles.filter((r) => r !== role) : [...entry.roles, role];
    update.mutate({ id: entry.id, roles });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-1">
        <CardTitle>Manufacturing Team</CardTitle>
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        Team members raise and edit MCNs; approvers approve, reject and reopen them; MCN admins manage this page.
        Everyone signed in can read MCNs. A change applies the next time a button is pressed.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-2/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <McnPersonPicker value={adding} people={people} onChange={setAdding} ariaLabel="Person to add" emptyLabel="Pick a person to add…" />
        <div className="flex flex-wrap gap-3 text-sm">
          {MCN_ROLES.map((role) => (
            <label key={role} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={newRoles.includes(role)}
                onChange={() => setNewRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]))}
                className="h-3.5 w-3.5 accent-cooper-red"
              />
              {MCN_ROLE_LABELS[role]}
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
        <LoadingTasks noun="the team" />
      ) : error ? (
        <p className="text-sm text-cooper-red">Couldn't load the MCN Roles list: {error instanceof Error ? error.message : "unknown error"}</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-fg-muted">Nobody yet — until somebody is added, nobody can raise an MCN.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="py-1.5 pr-3">Person</th>
                {MCN_ROLES.map((r) => (
                  <th key={r} className="px-2 py-1.5 text-center">
                    {MCN_ROLE_LABELS[r]}
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
                  {MCN_ROLES.map((role) => (
                    <td key={role} className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${entry.displayName || entry.email}: ${MCN_ROLE_LABELS[role]}`}
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
                        if (window.confirm(`Remove ${entry.displayName || entry.email} from the MCN team list?`)) remove.mutate(entry.id);
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

function GroupsCard() {
  const { data: groups = [], isLoading, error } = useMcnDistributionGroups();
  const people = usePeople();
  const setMembers = useSetMcnGroupMembers();
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-1">
        <CardTitle>Distribution groups</CardTitle>
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        Who receives an approved MCN for each Distribution box on the form. The approver sees these people when
        approving and can add or remove anyone; changes here apply to the next approval, not to MCNs already sent.
      </p>
      {isLoading ? (
        <LoadingTasks noun="the distribution groups" />
      ) : error ? (
        <p className="text-sm text-cooper-red">
          Couldn't load MCN Distribution Groups: {error instanceof Error ? error.message : "unknown error"}
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-fg-muted">The list is empty — the setup script seeds the eight roles.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {groups.map((group) => (
            <div key={group.id} className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
              <span className="pt-1.5 text-sm font-medium text-fg">{group.role}</span>
              <PersonMultiField
                value={group.members}
                allPeople={people}
                onToggle={(p) => {
                  const key = personKey(p);
                  const members = group.members.some((m) => personKey(m) === key)
                    ? group.members.filter((m) => personKey(m) !== key)
                    : [...group.members, p];
                  setMembers.mutate({ id: group.id, members });
                }}
                emptyLabel="Nobody — add someone"
                searchPlaceholder="Add a person…"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
