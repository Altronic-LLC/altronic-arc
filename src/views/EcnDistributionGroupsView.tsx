import { useMemo } from "react";
import { Users } from "lucide-react";
import type { Person } from "@/types/task";
import { ecnDistributionGroupsConfigured } from "@/api/ecnDistributionGroups";
import {
  useEcnDistributionGroups,
  useSetEcnDistributionGroupMembers,
} from "@/hooks/useEcnDistributionGroups";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { mergePeople, personKey } from "@/lib/people";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PersonMultiField } from "@/components/PersonMultiField";

// =============================================================================
// ECN distribution groups (BusinessIT#57) — /engineering/ecns/distribution.
//
// One row per role on the ECN form's DISTRIBUTION block, and who receives an
// ECN for it. Readable by anyone signed in; ARC admins edit (the hook asks
// again inside its mutationFn). People are PICKED from the staff directory,
// never typed — Graph accepts mail for an address that doesn't exist, so a
// typo would be silent for ever. A change applies to the next ECN signed off,
// never to one already sent.
// =============================================================================

export function EcnDistributionGroupsView() {
  const { data: groups = [], isLoading, error } = useEcnDistributionGroups();
  const setMembers = useSetEcnDistributionGroupMembers();
  const { isAdmin, isResolving } = useAdminAccess();
  const directory = useDirectoryPeople();
  const me = useCurrentUser();
  const people = useMemo(() => mergePeople(directory, [me]), [directory, me]);

  function toggle(groupId: number, members: Person[], p: Person) {
    const key = personKey(p);
    const next = members.some((m) => personKey(m) === key)
      ? members.filter((m) => personKey(m) !== key)
      : [...members, p];
    setMembers.mutate({ id: groupId, members: next });
  }

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="ECNs" listTo="/engineering/ecns" />

      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">ECN distribution groups</h1>
          <p className="text-sm text-fg-muted">
            Who receives an ECN for each role on its Distribution block. The ECN is emailed to the ticked roles the
            first time its Sign-off status is filled in; a change here applies to the next one, not to ECNs already
            sent.
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        {!isAdmin && !isResolving && (
          <p className="mb-3 text-[11px] text-fg-muted">Only ARC admins can change these groups.</p>
        )}
        {!ecnDistributionGroupsConfigured() ? (
          <p className="text-sm text-fg-muted">
            ECN Distribution Groups isn't set up yet: VITE_SP_ECN_DISTRIBUTION_GROUPS_LIST_ID is not set. Run
            scripts/create-ecn-distribution.ps1, which creates the list and prints its id.
          </p>
        ) : isLoading ? (
          <LoadingTasks noun="the distribution groups" />
        ) : error ? (
          <p className="text-sm text-cooper-red">
            Couldn't load ECN Distribution Groups: {error instanceof Error ? error.message : "unknown error"}
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-fg-muted">The list is empty — the setup script seeds the ten roles.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {groups.map((group) => (
              <div
                key={group.id}
                className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start"
              >
                <span className="pt-1.5 text-sm font-medium text-fg">{group.role}</span>
                {isAdmin ? (
                  <PersonMultiField
                    value={group.members}
                    allPeople={people}
                    onToggle={(p) => toggle(group.id, group.members, p)}
                    emptyLabel="Nobody — add someone"
                    searchPlaceholder="Add a person…"
                  />
                ) : (
                  <p className={`pt-1.5 text-sm ${group.members.length ? "text-fg" : "text-fg-muted"}`}>
                    {group.members.length
                      ? group.members.map((m) => m.displayName || m.email).join(", ")
                      : "Nobody set up"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
