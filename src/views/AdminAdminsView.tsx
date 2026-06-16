import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Shield, Trash2, UserPlus } from "lucide-react";
import { useAddAdmin, useAdmins, useRemoveAdmin } from "@/hooks/useAdmins";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SP_ADMINS_LIST_ID } from "@/api/config";
import { USE_MOCK } from "@/api/config";

/**
 * Admin → Admins page. Lists every entry in the Admins SharePoint list
 * and lets admins add / remove. Users with an email on this list see the
 * Admin link in the header and can reach this page; everyone else sees a
 * "not authorised" notice.
 */
export function AdminAdminsView() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const currentUser = useCurrentUser();
  const { data: admins = [], isLoading } = useAdmins();
  const add = useAddAdmin();
  const remove = useRemoveAdmin();
  const [showNew, setShowNew] = useState(false);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-12">
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-fg-muted">
          You don't have admin access. Ask another admin to add{" "}
          <code>{currentUser.email}</code> to the admin list.
        </div>
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
          <Shield className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Admins
          </h1>
          <p className="text-xs text-fg-muted">
            People with this email appear in the Admin section and can manage
            projects, the admin list, and any future admin-gated features.
          </p>
        </div>
        <nav className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 sm:flex-col sm:items-end">
          <Link
            to="/admin/projects"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Projects admin →
          </Link>
          <Link
            to="/admin/eir-roles"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            EIR Roles admin →
          </Link>
        </nav>
      </header>

      {!USE_MOCK && !SP_ADMINS_LIST_ID && (
        <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 p-3 text-xs text-fg">
          <span className="font-semibold text-ajax-yellow">Admins list not configured.</span>{" "}
          Create a SharePoint list (Title = email, plus DisplayName + Note text columns) and
          set <code>VITE_SP_ADMINS_LIST_ID</code>. Until then this page only shows the bootstrap
          admins from the code.
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <UserPlus className="h-4 w-4" /> Add admin
        </button>
      </div>

      {isLoading ? (
        <LoadingTasks noun="admins" />
      ) : admins.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          No admins on the list yet. Click "Add admin" to seed it.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => {
                const isSelf =
                  (currentUser.email ?? "").toLowerCase() === a.email.toLowerCase();
                const name = a.displayName || deriveNameFromEmail(a.email);
                return (
                  <tr
                    key={a.id}
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
                      {a.email}
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      {a.note || <span className="opacity-50">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove ${name} from the admin list?`,
                            )
                          ) {
                            remove.mutate(a.id);
                          }
                        }}
                        disabled={remove.isPending || isSelf}
                        title={isSelf ? "You can't remove yourself" : "Remove admin"}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg-muted transition-colors hover:border-cooper-red hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-fg-muted"
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
        <NewAdminModal
          onClose={() => {
            setShowNew(false);
            add.reset();
          }}
          onSubmit={async (input) => {
            try {
              await add.mutateAsync(input);
              setShowNew(false);
            } catch (err) {
              // Don't close — leave the modal open so the user can read the
              // error message rendered below and retry without re-typing.
              console.error("Failed to add admin:", err);
            }
          }}
          submitting={add.isPending}
          error={add.error instanceof Error ? add.error.message : null}
        />
      )}

      {remove.error && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't remove admin: {(remove.error as Error).message}
        </div>
      )}
    </div>
  );
}

function NewAdminModal({
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (input: { email: string; displayName: string; note: string }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-fg">
          <Plus className="h-4 w-4 text-accent" /> Add admin
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            onSubmit({
              email: email.trim().toLowerCase(),
              displayName: displayName.trim(),
              note: note.trim(),
            });
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="someone@altronic-llc.com"
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Display Name
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Smith"
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Note (optional)
            </span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
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
              {submitting ? "Adding…" : "Add admin"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Make a readable "First Last" out of an email address when the user
 * didn't bother filling in the Display Name field. Handles the common
 * altronic-llc.com pattern `first.last@…` (capitalises each segment) and
 * falls back to the raw local part for unusual formats.
 */
function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  if (!local) return email;
  const parts = local.split(/[._\-]+/).filter(Boolean);
  if (parts.length === 0) return local;
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ");
}
