import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useCreateQuickLink,
  useDeleteQuickLink,
  useMoveQuickLink,
  useQuickLinks,
  useUpdateQuickLink,
} from "@/hooks/useQuickLinks";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DASHBOARD_DEPARTMENTS, type DashboardDepartment, type QuickLink } from "@/types/task";
import { SP_QUICK_LINKS_LIST_ID, USE_MOCK } from "@/api/config";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";

// =============================================================================
// Admin → Quick Links.
//
// One shared table, grouped into the same seven department bands the
// Dashboard uses (`DASHBOARD_DEPARTMENTS`) — a link's Department tag is what
// puts it under that band on the Dashboard, so this screen groups the same
// way rather than showing one flat list an admin has to scan for a column.
//
// Reordering is up/down arrows within a department, not drag-and-drop: this
// list is short per department and arrows are keyboard- and
// screen-reader-reachable with no extra library wiring, unlike a drag
// handle. First/last in a department simply disable the arrow that would
// move them off the end.
// =============================================================================

export function AdminQuickLinksView() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const currentUser = useCurrentUser();
  const { data: links = [], isLoading } = useQuickLinks();
  const create = useCreateQuickLink();
  const update = useUpdateQuickLink();
  const move = useMoveQuickLink();
  const remove = useDeleteQuickLink();

  const [editing, setEditing] = useState<QuickLink | "new" | null>(null);
  const [newForDept, setNewForDept] = useState<DashboardDepartment | null>(null);

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

  const byDept = new Map<DashboardDepartment, QuickLink[]>();
  for (const dept of DASHBOARD_DEPARTMENTS) byDept.set(dept, []);
  for (const link of links) byDept.get(link.department)?.push(link);
  for (const list of byDept.values()) list.sort((a, b) => a.order - b.order || a.id - b.id);

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
          <Link2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Quick Links
          </h1>
          <p className="text-xs text-fg-muted">
            Button links shown above each department's cards on the Dashboard.
            Everyone signed in sees these; only admins can add, rename, reorder
            or remove one.
          </p>
        </div>
        <nav className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 sm:flex-col sm:items-end">
          <Link
            to="/admin/admins"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            ← Admin
          </Link>
        </nav>
      </header>

      {!USE_MOCK && !SP_QUICK_LINKS_LIST_ID && (
        <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 p-3 text-xs text-fg">
          <span className="font-semibold text-ajax-yellow">Quick Links list not configured.</span>{" "}
          Create a SharePoint list (Title = label, plus <code>Url</code> text, <code>Department</code>{" "}
          choice and <code>SortOrder</code> number columns) and set{" "}
          <code>VITE_SP_QUICK_LINKS_LIST_ID</code>. Until then no links show on the Dashboard.
        </div>
      )}

      {isLoading ? (
        <LoadingTasks noun="quick links" />
      ) : (
        <div className="flex flex-col gap-5">
          {DASHBOARD_DEPARTMENTS.map((dept) => {
            const deptLinks = byDept.get(dept) ?? [];
            return (
              <section key={dept} className="rounded-lg border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2">
                  <h2 className="text-sm font-semibold text-fg">{dept}</h2>
                  <button
                    onClick={() => setNewForDept(dept)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg transition-colors hover:border-accent hover:text-accent"
                  >
                    <Plus className="h-3 w-3" /> Add link
                  </button>
                </div>

                {deptLinks.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-fg-muted">
                    No links yet — nothing shows on the Dashboard for this department.
                  </p>
                ) : (
                  <ul>
                    {deptLinks.map((link, i) => (
                      <li
                        key={link.id}
                        className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 odd:bg-surface even:bg-surface-2/40"
                      >
                        <div className="flex shrink-0 flex-col">
                          <button
                            onClick={() => move.mutate({ id: link.id, direction: "up" })}
                            disabled={i === 0 || move.isPending}
                            aria-label={`Move ${link.label} up`}
                            className="rounded p-0.5 text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => move.mutate({ id: link.id, direction: "down" })}
                            disabled={i === deptLinks.length - 1 || move.isPending}
                            aria-label={`Move ${link.label} down`}
                            className="rounded p-0.5 text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">{link.label}</p>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 truncate text-xs text-fg-muted hover:text-accent"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{link.url}</span>
                          </a>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => setEditing(link)}
                            aria-label={`Edit ${link.label}`}
                            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:border-accent hover:text-accent"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Remove the "${link.label}" quick link?`)) {
                                remove.mutate(link.id);
                              }
                            }}
                            disabled={remove.isPending}
                            aria-label={`Remove ${link.label}`}
                            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:border-cooper-red hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {newForDept && (
        <QuickLinkFormModal
          title={`New link — ${newForDept}`}
          initial={{ label: "", url: "", department: newForDept }}
          submitting={create.isPending}
          error={create.error instanceof Error ? create.error.message : null}
          onClose={() => {
            setNewForDept(null);
            create.reset();
          }}
          onSubmit={async (input) => {
            try {
              await create.mutateAsync(input);
              setNewForDept(null);
            } catch (err) {
              console.error("Failed to add quick link:", err);
            }
          }}
        />
      )}

      {editing && editing !== "new" && (
        <QuickLinkFormModal
          title="Edit link"
          initial={{ label: editing.label, url: editing.url, department: editing.department }}
          submitting={update.isPending}
          error={update.error instanceof Error ? update.error.message : null}
          onClose={() => {
            setEditing(null);
            update.reset();
          }}
          onSubmit={async (input) => {
            try {
              await update.mutateAsync({ id: editing.id, input });
              setEditing(null);
            } catch (err) {
              console.error("Failed to update quick link:", err);
            }
          }}
        />
      )}

      {remove.error && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't remove the quick link: {(remove.error as Error).message}
        </div>
      )}
      {move.error && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't reorder: {(move.error as Error).message}
        </div>
      )}
    </div>
  );
}

interface QuickLinkFormValue {
  label: string;
  url: string;
  department: DashboardDepartment;
}

function QuickLinkFormModal({
  title,
  initial,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: QuickLinkFormValue;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: QuickLinkFormValue) => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [url, setUrl] = useState(initial.url);
  const [department, setDepartment] = useState<DashboardDepartment>(initial.department);
  const [validationError, setValidationError] = useState<string | null>(null);

  const overlayDismiss = useOverlayDismiss(onClose, submitting);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return setValidationError("Give the button a name.");
    if (!isLikelyUrl(url.trim())) {
      return setValidationError("Enter a full web address, starting with https:// or http://.");
    }
    setValidationError(null);
    onSubmit({ label: label.trim(), url: url.trim(), department });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-fg">
          <Link2 className="h-4 w-4 text-accent" /> {title}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Button name
            </span>
            <input
              autoFocus
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="CAD Vault"
              disabled={submitting}
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Web address
            </span>
            <input
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              disabled={submitting}
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>

          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Department
            </span>
            <ChoiceSelect
              value={department}
              onChange={(v) => setDepartment(v as DashboardDepartment)}
              options={DASHBOARD_DEPARTMENTS}
              emptyLabel="Choose a department"
              clearable={false}
              disabled={submitting}
              ariaLabel="Department"
            />
          </div>

          {(validationError || error) && (
            <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-2 py-1.5 text-xs text-cooper-red">
              {validationError || error}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Loose on purpose — this only blocks the obviously-wrong (no scheme, no host), not a full RFC check. */
function isLikelyUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !!parsed.hostname;
  } catch {
    return false;
  }
}
