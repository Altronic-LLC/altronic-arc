import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, ShieldCheck, Trash2, UserPlus, Wrench } from "lucide-react";
import {
  useAddMaintenanceRole,
  useMaintenanceRoles,
  useRemoveMaintenanceRole,
  useUpdateMaintenanceRole,
} from "@/hooks/useMaintenanceRoles";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useCurrentUserEmails } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useAdmins } from "@/hooks/useAdmins";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SingleSelect } from "@/components/SearchableSelect";
import { looksLikeEmail, matchesAnyEmail } from "@/lib/emailIdentity";
import { MAINTENANCE_ROLES, type MaintenanceRole, type Person } from "@/types/task";
import { SP_MAINTENANCE_ROLES_LIST_ID, USE_MOCK } from "@/api/config";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";
import { mergePeople, personKey } from "@/lib/people";

// =============================================================================
// Admin → Maintenance Roles.
//
// Mirrors AdminEirRolesView deliberately, down to the "not an email" warning:
// roles are matched on address, so a display name typed into the Title column
// grants nothing and errors nowhere — the person simply reports that their
// role "isn't working". This is the one screen where that can be spotted.
// =============================================================================

const ROLE_LABELS: Record<MaintenanceRole, string> = {
  tech: "Tech",
  admin: "Admin",
};

const ROLE_GATES: Record<MaintenanceRole, string> = {
  tech: "Can complete work orders, and log a PM (Start / Complete / Skip)",
  admin:
    "Everything a Tech can do, plus creating / editing / retiring PM schedules and managing the asset register",
};

export function AdminMaintenanceRolesView() {
  const navigate = useNavigate();
  // `useAdminAccess`, not `useIsAdmin`: the Admins list loads asynchronously,
  // and telling somebody they lack access and then taking it back a moment
  // later is worse than a spinner.
  const { isAdmin, isResolving } = useAdminAccess();
  const myEmails = useCurrentUserEmails();
  const { data: entries = [], isLoading } = useMaintenanceRoles();
  const add = useAddMaintenanceRole();
  const update = useUpdateMaintenanceRole();
  const remove = useRemoveMaintenanceRole();
  const [showNew, setShowNew] = useState(false);

  // People to offer in the picker: the staff directory, plus the Admins list
  // so an admin can always be tagged even before they appear in the directory
  // (or if the directory read isn't consented in this tenant).
  const directory = useDirectoryPeople();
  const { data: admins = [] } = useAdmins();
  const pickablePeople = useMemo<Person[]>(
    () =>
      mergePeople(
        directory,
        admins.map((a) => ({ displayName: a.displayName || a.email, email: a.email })),
      ),
    [directory, admins],
  );

  // Someone already tagged shouldn't be offered again: a second row is a
  // duplicate, and `useMyMaintenanceRoles` only ever reads the FIRST match, so
  // the second row's tags would silently do nothing.
  const alreadyTagged = useMemo(
    () => new Set(entries.map((e) => e.email.trim().toLowerCase())),
    [entries],
  );

  if (isResolving) {
    return <LoadingTasks noun="maintenance roles" />;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-fg-muted" />
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">Admin access required</h1>
        <p className="mt-2 text-sm text-fg-muted">
          The Maintenance Roles admin page is restricted to authorised users. If
          you need access, contact your administrator.
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the dashboard
        </button>
      </div>
    );
  }

  function toggleRole(id: number, current: MaintenanceRole[], role: MaintenanceRole) {
    const next = current.includes(role)
      ? current.filter((r) => r !== role)
      : [...current, role];
    update.mutate({ id, roles: next });
  }

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <Wrench className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Maintenance Roles
          </h1>
          <p className="text-xs text-fg-muted">
            Who may close out work orders, log PMs, and own the PM schedules and
            asset register. Raising a work order, editing an open one,
            commenting and attaching files stay open to everyone signed in.
          </p>
        </div>
        <nav className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 sm:flex-col sm:items-end">
          <Link to="/admin/admins" className="text-xs text-accent underline-offset-2 hover:underline">
            Admins →
          </Link>
          <Link
            to="/admin/eir-roles"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            EIR Roles →
          </Link>
          <Link
            to="/operations/maintenance"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Work Orders →
          </Link>
        </nav>
      </header>

      {!USE_MOCK && !SP_MAINTENANCE_ROLES_LIST_ID && (
        <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 p-3 text-xs text-fg">
          <span className="font-semibold text-ajax-yellow">
            Maintenance Roles list not configured.
          </span>{" "}
          Run <code>scripts/create-maintenance-roles-list.ps1</code> and set{" "}
          <code>VITE_SP_MAINTENANCE_ROLES_LIST_ID</code>. Until then, CMMS role
          gating is OFF — everyone signed in can complete work orders, log PMs
          and manage schedules — and this page can't store changes. Populate the
          list before setting the variable, or the techs not yet on it lose what
          they can do today. Note that <code>VITE_*</code> values are baked in at
          build time, so a repo variable does nothing until the next deploy.
        </div>
      )}

      {/* What each tag actually unlocks, stated on the page rather than only in
          a checkbox tooltip: an admin granting a role needs to know what they
          are granting without hovering to find out. */}
      <div className="rounded-lg border border-border bg-surface-2/40 p-3">
        <h2 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          What these roles gate
        </h2>
        <ul className="flex flex-col gap-1.5 text-xs text-fg">
          {MAINTENANCE_ROLES.map((role) => (
            <li key={role} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{ROLE_LABELS[role]}</span>
              <span className="text-fg-muted">{ROLE_GATES[role]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-fg-muted">
          Admin outranks Tech, so an Admin needs no Tech tag. ARC admins (the
          Admins list) always count as maintenance admins, whether or not they
          appear here.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <UserPlus className="h-4 w-4" /> Add user
        </button>
      </div>

      {isLoading ? (
        <LoadingTasks noun="maintenance roles" />
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          Nobody tagged yet. Click "Add user" to grant maintenance permissions.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Roles</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                // The SAME matcher the gates use, so this table can't mark a
                // different row "you" than the one granting your roles.
                const isSelf = matchesAnyEmail(myEmails, e.email);
                const name = e.displayName || deriveNameFromEmail(e.email);
                const notAnEmail = !looksLikeEmail(e.email);
                return (
                  <tr
                    key={e.id}
                    className="border-b border-border last:border-b-0 odd:bg-surface even:bg-surface-2/40"
                  >
                    <td className="px-3 py-2 font-medium text-fg">
                      {name}
                      {isSelf && (
                        <span className="ml-2 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          you
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                      {e.email || <span className="italic">not set</span>}
                      {notAnEmail && (
                        <span
                          className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-amber-700 dark:text-amber-400"
                          title="Roles are matched on email address. Until this is an address, this row grants nothing."
                        >
                          not an email
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-3">
                        {MAINTENANCE_ROLES.map((role) => (
                          <label
                            key={role}
                            className="inline-flex items-center gap-1.5 text-xs text-fg"
                            title={ROLE_GATES[role]}
                          >
                            <input
                              type="checkbox"
                              checked={e.roles.includes(role)}
                              disabled={update.isPending}
                              onChange={() => toggleRole(e.id, e.roles, role)}
                              className="h-3.5 w-3.5 accent-accent"
                            />
                            {ROLE_LABELS[role]}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      {e.note || <span className="opacity-50">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => {
                          if (
                            window.confirm(`Remove ${name} from the Maintenance Roles list?`)
                          ) {
                            remove.mutate(e.id);
                          }
                        }}
                        disabled={remove.isPending}
                        title="Remove user"
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg-muted transition-colors hover:border-cooper-red hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewMaintenanceRoleModal
          people={pickablePeople}
          alreadyTagged={alreadyTagged}
          onClose={() => {
            setShowNew(false);
            add.reset();
          }}
          onSubmit={async (input) => {
            try {
              await add.mutateAsync(input);
              setShowNew(false);
            } catch (err) {
              console.error("Failed to add maintenance role:", err);
            }
          }}
          submitting={add.isPending}
          error={add.error instanceof Error ? add.error.message : null}
        />
      )}

      {remove.error && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't remove user: {(remove.error as Error).message}
        </div>
      )}
      {update.error && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't update roles: {(update.error as Error).message}
        </div>
      )}
    </div>
  );
}

function NewMaintenanceRoleModal({
  people,
  alreadyTagged,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  people: Person[];
  alreadyTagged: Set<string>;
  onClose: () => void;
  onSubmit: (input: {
    email: string;
    displayName: string;
    roles: MaintenanceRole[];
    note: string;
  }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [roles, setRoles] = useState<MaintenanceRole[]>([]);
  /**
   * Escape hatch. `useDirectoryPeople` degrades to [] when the tenant
   * directory can't be read, and a new starter may not be in it yet — without
   * a manual route an admin would simply be stuck. Off by default so the safe
   * path (pick a known person) is the one people take.
   */
  const [manual, setManual] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [manualName, setManualName] = useState("");

  const options = useMemo(() => {
    return people
      .filter((p) => p.email && !alreadyTagged.has(p.email.toLowerCase()))
      .map((p) => ({
        value: personKey(p),
        // The email is part of the LABEL, not just the value: searching
        // matches on the label, and two people sharing a name are otherwise
        // indistinguishable.
        label: p.email ? `${p.displayName} — ${p.email}` : p.displayName,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [people, alreadyTagged]);

  const selectedPerson = useMemo(
    () => people.find((p) => personKey(p) === selectedKey) ?? null,
    [people, selectedKey],
  );

  const directoryEmpty = people.length === 0;
  const email = manual ? manualEmail.trim().toLowerCase() : (selectedPerson?.email ?? "");
  const displayName = manual ? manualName.trim() : (selectedPerson?.displayName ?? "");
  const duplicate = !!email && alreadyTagged.has(email.toLowerCase());
  const canSubmit = !!email && !duplicate && !submitting;

  function toggle(role: MaintenanceRole) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  const overlayDismiss = useOverlayDismiss(onClose);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-fg">
          <Plus className="h-4 w-4 text-accent" /> Add user to Maintenance Roles
        </h2>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!canSubmit) return;
            onSubmit({
              email: email.toLowerCase(),
              displayName,
              roles,
              note: note.trim(),
            });
          }}
          className="flex flex-col gap-3"
        >
          {!manual ? (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Person</span>
              <SingleSelect
                allLabel="Search for a person…"
                searchPlaceholder="Type a name or email…"
                options={options}
                selected={selectedKey}
                onChange={setSelectedKey}
              />
              {selectedPerson && (
                <span className="mt-0.5 font-mono text-[11px] text-fg-muted">
                  {selectedPerson.email}
                </span>
              )}
              <button
                type="button"
                onClick={() => setManual(true)}
                className="mt-1 w-fit text-[11px] text-accent underline-offset-2 hover:underline"
              >
                {directoryEmpty
                  ? "No people loaded — enter an email manually"
                  : "Can't find them? Enter an email manually"}
              </button>
            </div>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Email</span>
                <input
                  type="email"
                  required
                  value={manualEmail}
                  onChange={(ev) => setManualEmail(ev.target.value)}
                  placeholder="someone@altronic-llc.com"
                  className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <span className="text-[11px] text-fg-muted">
                  Must be the person's mailbox — a typo here creates a row that
                  silently grants nothing.
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">
                  Display Name
                </span>
                <input
                  type="text"
                  value={manualName}
                  onChange={(ev) => setManualName(ev.target.value)}
                  placeholder="Jane Smith"
                  className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </label>
              <button
                type="button"
                onClick={() => setManual(false)}
                className="w-fit text-[11px] text-accent underline-offset-2 hover:underline"
              >
                ← Back to searching people
              </button>
            </>
          )}

          {duplicate && (
            <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-2 py-1.5 text-xs text-fg">
              That person is already on the list — edit their roles in the table
              instead of adding them twice.
            </div>
          )}
          <fieldset className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Roles</span>
            <div className="flex flex-wrap gap-4">
              {MAINTENANCE_ROLES.map((role) => (
                <label
                  key={role}
                  className="inline-flex items-center gap-1.5 text-sm text-fg"
                  title={ROLE_GATES[role]}
                >
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={() => toggle(role)}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Note (optional)
            </span>
            <input
              type="text"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              placeholder="Role / context for granting access"
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          {error && (
            <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-2 py-1.5 text-xs text-cooper-red">
              {error}
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Make a readable "First Last" out of an email when no Display Name was set.
 * Mirrors the helper in AdminEirRolesView / AdminAdminsView.
 */
function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  if (!local) return email;
  const parts = local.split(/[._\-]+/).filter(Boolean);
  if (parts.length === 0) return local;
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ");
}

export default AdminMaintenanceRolesView;
