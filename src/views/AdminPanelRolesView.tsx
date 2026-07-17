import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import {
  useAddPanelRole,
  usePanelRoles,
  useRemovePanelRole,
  useUpdatePanelRole,
} from "@/hooks/usePanelRoles";
import { usePanelSiteUsers } from "@/hooks/usePanelOrders";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SingleSelect } from "@/components/SearchableSelect";
import { PANEL_ROLE_CHOICES, type PanelRole, type Person } from "@/types/task";

/**
 * Admin → Panel User Roles page. One row per user PER role (the SharePoint
 * list's shape — a user holding two roles appears twice). Roles map to edit
 * rights via lib/panelRoles.ts (Tech/Manager → production, Engineer →
 * engineering, Admin/Super User → both, Viewer → none), but v1 gates no
 * fields — this list is bookkeeping until the first gated field is wired.
 * Access gated by useIsAdmin().
 */
export function AdminPanelRolesView() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const currentUser = useCurrentUser();
  const { data: entries = [], isLoading } = usePanelRoles();
  const add = useAddPanelRole();
  const update = useUpdatePanelRole();
  const remove = useRemovePanelRole();
  const [showNew, setShowNew] = useState(false);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-fg-muted" />
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">Admin access required</h1>
        <p className="mt-2 text-sm text-fg-muted">
          The Panel User Roles admin page is restricted to authorised users.
          If you need access, contact your administrator.
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </button>
      </div>
    );
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
            Panel User Roles
          </h1>
          <p className="text-xs text-fg-muted">
            Tag panel team members with a role. One row per user per role — a
            user can hold several. Roles don't lock any panel order fields yet;
            they're recorded now so field-level permissions can be switched on
            later without a data migration.
          </p>
        </div>
        <nav className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 sm:flex-col sm:items-end">
          <Link to="/admin/admins" className="text-xs text-accent underline-offset-2 hover:underline">
            Admins →
          </Link>
          <Link to="/admin/panel-projects" className="text-xs text-accent underline-offset-2 hover:underline">
            Panel Projects →
          </Link>
          <Link to="/admin/eir-roles" className="text-xs text-accent underline-offset-2 hover:underline">
            EIR Roles →
          </Link>
        </nav>
      </header>

      <div className="flex justify-end">
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <UserPlus className="h-4 w-4" /> Add role
        </button>
      </div>

      {isLoading ? (
        <LoadingTasks noun="panel roles" />
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          No roles assigned yet. Click "Add role" to tag the first user.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const isSelf =
                  !!currentUser.email &&
                  (e.user?.email ?? "").toLowerCase() === currentUser.email.toLowerCase();
                const name = e.user?.displayName || `User #${e.user?.lookupId ?? "?"}`;
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
                      {e.user?.email && (
                        <span className="mt-0.5 block font-mono text-xs font-normal text-fg-muted">
                          {e.user.email}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={e.role ?? ""}
                        disabled={update.isPending}
                        onChange={(ev) =>
                          update.mutate({ id: e.id, role: ev.target.value as PanelRole })
                        }
                        className="select max-w-[12rem]"
                      >
                        {!e.role && <option value="">Not set</option>}
                        {PANEL_ROLE_CHOICES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      {e.note || <span className="opacity-50">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => {
                          if (window.confirm(`Remove ${name}'s "${e.role ?? "?"}" role?`)) {
                            remove.mutate(e.id);
                          }
                        }}
                        disabled={remove.isPending}
                        title="Remove role"
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
        <NewPanelRoleModal
          onClose={() => {
            setShowNew(false);
            add.reset();
          }}
          onSubmit={async (input) => {
            try {
              await add.mutateAsync(input);
              setShowNew(false);
            } catch (err) {
              console.error("Failed to add panel role:", err);
            }
          }}
          submitting={add.isPending}
          error={add.error instanceof Error ? add.error.message : null}
        />
      )}

      {remove.error && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't remove role: {(remove.error as Error).message}
        </div>
      )}
      {update.error && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't update role: {(update.error as Error).message}
        </div>
      )}
    </div>
  );
}

function NewPanelRoleModal({
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (input: { user: Person; role: PanelRole; note?: string }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const { data: siteUsers = [], isLoading } = usePanelSiteUsers();
  const [userKey, setUserKey] = useState<string | null>(null);
  const [role, setRole] = useState<PanelRole | "">("");
  const [note, setNote] = useState("");

  const selectedUser = userKey
    ? siteUsers.find((p) => String(p.lookupId ?? p.email ?? p.displayName) === userKey) ?? null
    : null;

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
          <Plus className="h-4 w-4 text-accent" /> Add panel role
        </h2>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!selectedUser || !role) return;
            onSubmit({ user: selectedUser, role, note: note.trim() || undefined });
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">User</span>
            <SingleSelect
              allLabel={isLoading ? "Loading site users…" : "Pick a user"}
              searchPlaceholder="Search people…"
              options={siteUsers.map((p) => ({
                value: String(p.lookupId ?? p.email ?? p.displayName),
                label: p.email ? `${p.displayName} (${p.email})` : p.displayName,
              }))}
              selected={userKey}
              onChange={setUserKey}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Role</span>
            <select
              value={role}
              onChange={(ev) => setRole(ev.target.value as PanelRole | "")}
              className="select"
              required
            >
              <option value="">Pick a role</option>
              {PANEL_ROLE_CHOICES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Note (optional)
            </span>
            <input
              type="text"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              placeholder="Context for granting this role"
              className="select"
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
              disabled={submitting || !selectedUser || !role}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
