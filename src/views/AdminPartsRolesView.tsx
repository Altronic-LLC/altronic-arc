import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Cpu, Plus, Trash2, UserPlus } from "lucide-react";
import {
  useAddPartsRole,
  usePartsRoles,
  useRemovePartsRole,
  useUpdatePartsRole,
} from "@/hooks/usePartsRoles";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useCurrentUserEmails } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useAdmins } from "@/hooks/useAdmins";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SingleSelect } from "@/components/SearchableSelect";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";
import { looksLikeEmail, matchesAnyEmail } from "@/lib/emailIdentity";
import { mergePeople, personKey } from "@/lib/people";
import {
  PARTS_ROLE_DESCRIPTIONS,
  PARTS_ROLE_LABELS,
  PARTS_ROLE_TAGS,
  partsRightsFor,
  type PartsRole,
} from "@/lib/partsRoles";
import type { Person } from "@/types/task";
import { SP_PARTS_ROLES_LIST_ID, USE_MOCK } from "@/api/config";

// =============================================================================
// Admin → Parts Roles. Who may add, edit and approve parts on the Altronic
// Parts List (Tim, 2026-09-28: an admin-managed list, so people can be added
// or changed later without a code change — including who is an HCO editor,
// which the 2023 guide hard-wired to three named people).
//
// ARC admins manage it (RequireAdmin on the route, useIsAdmin in every
// mutation). The tags and what they imply live in lib/partsRoles.ts; this
// page states them in words so nobody has to hover to learn what they grant.
// =============================================================================

export function AdminPartsRolesView() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const myEmails = useCurrentUserEmails();
  const { data: entries = [], isLoading, error } = usePartsRoles();
  const add = useAddPartsRole();
  const update = useUpdatePartsRole();
  const remove = useRemovePartsRole();
  const [showNew, setShowNew] = useState(false);

  const directory = useDirectoryPeople();
  const { data: admins = [] } = useAdmins();
  const pickablePeople = useMemo<Person[]>(
    () => mergePeople(directory, admins.map((a) => ({ displayName: a.displayName || a.email, email: a.email }))),
    [directory, admins],
  );
  // A second row for the same person would be silently ignored (the first
  // match wins), so they aren't offered again.
  const alreadyTagged = useMemo(() => new Set(entries.map((e) => e.email.trim().toLowerCase())), [entries]);

  const reviewers = entries.filter((e) => partsRightsFor(e.roles).approveEngineering);
  const sapAdmins = entries.filter((e) => partsRightsFor(e.roles).approveSap);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <Cpu className="mx-auto h-10 w-10 text-fg-muted" />
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">Admin access required</h1>
        <p className="mt-2 text-sm text-fg-muted">
          The Parts Roles page is for ARC admins. Ask one if somebody needs Parts List access.
        </p>
      </div>
    );
  }

  function toggleRole(id: number, current: PartsRole[], role: PartsRole) {
    const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    update.mutate({ id, roles: next });
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <Cpu className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Parts Roles</h1>
          <p className="text-xs text-fg-muted">
            Who can add, edit and approve parts on the Parts List. Everyone signed in can read and
            search it; only the people here can change it.
          </p>
        </div>
        <nav className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 sm:flex-col sm:items-end">
          <Link to="/admin/admins" className="text-xs text-accent underline-offset-2 hover:underline">
            Admins →
          </Link>
          <Link to="/admin/eir-roles" className="text-xs text-accent underline-offset-2 hover:underline">
            EIR Roles →
          </Link>
          <Link to="/engineering/parts" className="text-xs text-accent underline-offset-2 hover:underline">
            Parts List →
          </Link>
        </nav>
      </header>

      {!USE_MOCK && !SP_PARTS_ROLES_LIST_ID && (
        <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 p-3 text-xs text-fg">
          <span className="font-semibold text-ajax-yellow">Parts Roles list not configured.</span>{" "}
          Run <code>scripts/create-altronic-parts-lists.ps1</code> to create it, then set{" "}
          <code>VITE_SP_PARTS_ROLES_LIST_ID</code> and redeploy. Until then the Parts List is
          read-only for everyone and this page can't store changes.
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface-2/40 p-3">
        <h2 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          What each role allows
        </h2>
        <ul className="flex flex-col gap-1.5 text-xs text-fg">
          {PARTS_ROLE_TAGS.map((role) => (
            <li key={role} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{PARTS_ROLE_LABELS[role]}</span>
              <span className="text-fg-muted">{PARTS_ROLE_DESCRIPTIONS[role]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-fg-muted">
          New components email the reviewing engineers (
          {reviewers.map((e) => e.displayName || e.email).join(", ") || "nobody yet"}); new parts, finished
          engineering reviews and every edit email the SAP admins (
          {sapAdmins.map((e) => e.displayName || e.email).join(", ") || "nobody yet"}).
        </p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <UserPlus className="h-4 w-4" /> Add person
        </button>
      </div>

      {isLoading ? (
        <LoadingTasks noun="parts roles" />
      ) : error ? (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't load the Parts Roles list: {(error as Error).message}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          Nobody has a Parts List role yet. Click "Add person" to start.
        </div>
      ) : (
        <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] text-sm">
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
                const isSelf = matchesAnyEmail(myEmails, e.email);
                const name = e.displayName || e.email;
                return (
                  <tr key={e.id} className="border-b border-border last:border-b-0 odd:bg-surface even:bg-surface-2/40">
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
                      {!looksLikeEmail(e.email) && (
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
                        {PARTS_ROLE_TAGS.map((role) => (
                          <label
                            key={role}
                            className="inline-flex items-center gap-1.5 text-xs text-fg"
                            title={PARTS_ROLE_DESCRIPTIONS[role]}
                          >
                            <input
                              type="checkbox"
                              checked={e.roles.includes(role)}
                              disabled={update.isPending}
                              onChange={() => toggleRole(e.id, e.roles, role)}
                              className="h-3.5 w-3.5 accent-accent"
                            />
                            {PARTS_ROLE_LABELS[role]}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{e.note || <span className="opacity-50">—</span>}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => {
                          if (window.confirm(`Remove ${name} from Parts Roles?`)) remove.mutate(e.id);
                        }}
                        disabled={remove.isPending}
                        title="Remove person"
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
        <NewPartsRoleModal
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
            } catch {
              // Shown in the modal from add.error.
            }
          }}
          submitting={add.isPending}
          error={add.error instanceof Error ? add.error.message : null}
        />
      )}

      {remove.error && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't remove that person: {(remove.error as Error).message}
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

function NewPartsRoleModal({
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
  onSubmit: (input: { email: string; displayName: string; roles: PartsRole[]; note: string }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [roles, setRoles] = useState<PartsRole[]>([]);
  // Escape hatch for somebody the directory can't show (a new starter, or a
  // tenant where the directory read isn't consented).
  const [manual, setManual] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [manualName, setManualName] = useState("");

  const options = useMemo(
    () =>
      people
        .filter((p) => p.email && !alreadyTagged.has(p.email.toLowerCase()))
        .map((p) => ({ value: personKey(p), label: p.email ? `${p.displayName} — ${p.email}` : p.displayName }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [people, alreadyTagged],
  );
  const selectedPerson = useMemo(() => people.find((p) => personKey(p) === selectedKey) ?? null, [people, selectedKey]);

  const email = manual ? manualEmail.trim().toLowerCase() : (selectedPerson?.email ?? "").toLowerCase();
  const displayName = manual ? manualName.trim() : (selectedPerson?.displayName ?? "");
  const duplicate = !!email && alreadyTagged.has(email);
  const canSubmit = !!email && !duplicate && roles.length > 0 && !submitting;

  const overlayDismiss = useOverlayDismiss(onClose);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add person to Parts Roles"
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-fg">
          <Plus className="h-4 w-4 text-accent" /> Add person to Parts Roles
        </h2>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (canSubmit) onSubmit({ email, displayName, roles, note: note.trim() });
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
              <button
                type="button"
                onClick={() => setManual(true)}
                className="mt-1 w-fit text-[11px] text-accent underline-offset-2 hover:underline"
              >
                Can't find them? Enter an email manually
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
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Display Name</span>
                <input type="text" value={manualName} onChange={(ev) => setManualName(ev.target.value)} className="input" />
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
              That person is already on the list — change their roles in the table instead.
            </div>
          )}
          <fieldset className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Roles</span>
            {PARTS_ROLE_TAGS.map((role) => (
              <label key={role} className="flex items-start gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={() => setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))}
                  className="mt-1 h-3.5 w-3.5 accent-accent"
                />
                <span>
                  {PARTS_ROLE_LABELS[role]}
                  <span className="block text-[11px] text-fg-muted">{PARTS_ROLE_DESCRIPTIONS[role]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Note (optional)</span>
            <input type="text" value={note} onChange={(ev) => setNote(ev.target.value)} className="input" />
          </label>
          {error && (
            <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-2 py-1.5 text-xs text-cooper-red">
              {error}
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add person"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
