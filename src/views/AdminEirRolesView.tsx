import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import {
  useAddEirRole,
  useEirRoles,
  useRemoveEirRole,
  useUpdateEirRole,
} from "@/hooks/useEirRoles";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadingTasks } from "@/components/LoadingTasks";
import { EIR_ROLES, type EirRole } from "@/types/task";
import { SP_EIR_ROLES_LIST_ID, USE_MOCK } from "@/api/config";

const ROLE_LABELS: Record<EirRole, string> = {
  engineer: "Engineer",
  "supply chain": "Supply Chain",
};

const ROLE_GATES: Record<EirRole, string> = {
  engineer: "Can edit Engineering Response + Technical Priority",
  "supply chain": "Can edit Buyer Code, Risk Part + Risk Part Level",
};

/**
 * Admin → EIR Roles page. Lists every entry in the EIR Roles SharePoint list
 * and lets admins add / remove users and toggle their role tags. Roles gate
 * which fields a user may edit on an EIR (Engineering Response = engineer,
 * Buyer Code = supply chain). Access gated by useIsAdmin().
 */
export function AdminEirRolesView() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const currentUser = useCurrentUser();
  const { data: entries = [], isLoading } = useEirRoles();
  const add = useAddEirRole();
  const update = useUpdateEirRole();
  const remove = useRemoveEirRole();
  const [showNew, setShowNew] = useState(false);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-fg-muted" />
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">Admin access required</h1>
        <p className="mt-2 text-sm text-fg-muted">
          The EIR Roles admin page is restricted to authorised users. If you
          need access, contact your administrator.
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to task list
        </button>
      </div>
    );
  }

  function toggleRole(id: number, current: EirRole[], role: EirRole) {
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
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            EIR Roles
          </h1>
          <p className="text-xs text-fg-muted">
            Tag users with elevated EIR permissions. Engineers can edit the
            Engineering Response; Supply Chain can edit the Buyer Code. Everyone
            else can still edit all other EIR fields.
          </p>
        </div>
        <nav className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 sm:flex-col sm:items-end">
          <Link to="/admin/admins" className="text-xs text-accent underline-offset-2 hover:underline">
            Admins →
          </Link>
          <Link to="/admin/projects" className="text-xs text-accent underline-offset-2 hover:underline">
            Engineering Project Log →
          </Link>
          <Link to="/admin/operations-projects" className="text-xs text-accent underline-offset-2 hover:underline">
            Operations Projects →
          </Link>
          <Link to="/admin/panel-roles" className="text-xs text-accent underline-offset-2 hover:underline">
            Panel User Roles →
          </Link>
        </nav>
      </header>

      {!USE_MOCK && !SP_EIR_ROLES_LIST_ID && (
        <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 p-3 text-xs text-fg">
          <span className="font-semibold text-ajax-yellow">EIR Roles list not configured.</span>{" "}
          Create a SharePoint list (Title = email, plus DisplayName, Note, and Roles text columns)
          and set <code>VITE_SP_EIR_ROLES_LIST_ID</code>. Until then, EIR field gating is OFF
          (everyone can edit every field) and this page can't store changes.
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <UserPlus className="h-4 w-4" /> Add user
        </button>
      </div>

      {isLoading ? (
        <LoadingTasks noun="EIR roles" />
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          No users tagged yet. Click "Add user" to grant EIR permissions.
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
                const isSelf =
                  (currentUser.email ?? "").toLowerCase() === e.email.toLowerCase();
                const name = e.displayName || deriveNameFromEmail(e.email);
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
                    <td className="px-3 py-2 font-mono text-xs text-fg-muted">{e.email}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-3">
                        {EIR_ROLES.map((role) => (
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
                          if (window.confirm(`Remove ${name} from the EIR Roles list?`)) {
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
        <NewEirRoleModal
          onClose={() => {
            setShowNew(false);
            add.reset();
          }}
          onSubmit={async (input) => {
            try {
              await add.mutateAsync(input);
              setShowNew(false);
            } catch (err) {
              console.error("Failed to add EIR role:", err);
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

function NewEirRoleModal({
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (input: {
    email: string;
    displayName: string;
    roles: EirRole[];
    note: string;
  }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");
  const [roles, setRoles] = useState<EirRole[]>([]);

  function toggle(role: EirRole) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-fg">
          <Plus className="h-4 w-4 text-accent" /> Add user to EIR Roles
        </h2>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!email.trim()) return;
            onSubmit({
              email: email.trim().toLowerCase(),
              displayName: displayName.trim(),
              roles,
              note: note.trim(),
            });
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              placeholder="someone@altronic-llc.com"
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Display Name</span>
            <input
              type="text"
              value={displayName}
              onChange={(ev) => setDisplayName(ev.target.value)}
              placeholder="Jane Smith"
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <fieldset className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Roles</span>
            <div className="flex flex-wrap gap-4">
              {EIR_ROLES.map((role) => (
                <label key={role} className="inline-flex items-center gap-1.5 text-sm text-fg" title={ROLE_GATES[role]}>
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
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Note (optional)</span>
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
              disabled={submitting || !email.trim()}
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
 * Mirrors the helper in AdminAdminsView.
 */
function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  if (!local) return email;
  const parts = local.split(/[._\-]+/).filter(Boolean);
  if (parts.length === 0) return local;
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ");
}
