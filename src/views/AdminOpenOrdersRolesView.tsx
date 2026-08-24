import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import {
  useCreateOpenOrdersRole,
  useDeleteOpenOrdersRole,
  useOpenOrdersRoles,
  useUpdateOpenOrdersRole,
} from "@/hooks/useOpenOrdersCustomers";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useCurrentUserEmails } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SingleSelect } from "@/components/SearchableSelect";
import { looksLikeEmail, matchesAnyEmail } from "@/lib/emailIdentity";
import { OPEN_ORDERS_ROLES, type OpenOrdersRole } from "@/types/task";
import { SP_OPEN_ORDERS_ROLES_LIST_ID, USE_MOCK } from "@/api/config";
import { cn } from "@/lib/cn";

const ROLE_LABELS: Record<OpenOrdersRole, string> = {
  "report manager": "Report manager",
};

const ROLE_GATES: Record<OpenOrdersRole, string> = {
  "report manager": "Can run the weekly generation and edit the customer list",
};

/**
 * Admin → Open Orders Roles.
 *
 * Deliberately the same screen as Admin → EIR Roles, because Ray asked for
 * these permissions to work "like the eir permissions" (2026-08-24) and two
 * different-looking screens for the same job is how people learn one and
 * mistrust the other.
 */
export function AdminOpenOrdersRolesView() {
  const { isAdmin, isResolving } = useAdminAccess();
  const myEmails = useCurrentUserEmails();
  const { data: entries = [], isLoading } = useOpenOrdersRoles();
  const directory = useDirectoryPeople();
  const create = useCreateOpenOrdersRole();
  const update = useUpdateOpenOrdersRole();
  const remove = useDeleteOpenOrdersRole();

  const [adding, setAdding] = useState<string | null>(null);

  const configured = USE_MOCK || !!SP_OPEN_ORDERS_ROLES_LIST_ID;

  // Anyone in the directory who isn't already on the list.
  const options = useMemo(() => {
    const taken = new Set(entries.map((e) => e.email.toLowerCase()));
    return directory
      .filter((p) => !!p.email && !taken.has(p.email.toLowerCase()))
      .map((p) => ({ value: p.email as string, label: `${p.displayName} · ${p.email}` }));
  }, [directory, entries]);

  if (isLoading || isResolving) return <LoadingTasks />;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-fg-muted" />
        <h1 className="mt-3 font-display text-lg font-semibold text-fg">Admins only</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Only an ARC admin can change who runs the Open Orders reports.
        </p>
      </div>
    );
  }

  function toggle(id: number, email: string, displayName: string, note: string, roles: OpenOrdersRole[], role: OpenOrdersRole) {
    const next = roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role];
    update.mutate({ id, entry: { email, displayName, note, roles: next } });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/sales/open-orders"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Open Orders
        </Link>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
          <ShieldCheck className="h-5 w-5 text-accent" />
          Open Orders roles
        </h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          A <strong className="text-fg">report manager</strong> can run the weekly
          generation and edit the customer list. Everyone else signed in can open the
          screen and download the reports, which is what most of Sales needs.
        </p>
        <p className="text-xs text-fg-muted">
          Admins can always do both, whatever this list says — otherwise a list nobody
          holds the role on would be a door locked from the inside.
        </p>
      </header>

      {!configured && (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/5 px-4 py-3 text-sm">
          <span className="font-medium text-fg">Role gating is off.</span>{" "}
          <span className="text-fg-muted">
            The Open Orders Roles list isn't configured yet, so <em>anyone</em> signed in
            can run the reports and edit the customer list. Create the list with{" "}
            <span className="font-mono text-xs">scripts/create-open-orders-lists.ps1</span>{" "}
            and set <span className="font-mono text-xs">VITE_SP_OPEN_ORDERS_ROLES_LIST_ID</span>.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <SingleSelect
            allLabel="Add someone…"
            searchPlaceholder="Search the directory…"
            options={options}
            selected={adding}
            onChange={setAdding}
            ariaLabel="Add someone to the Open Orders roles"
          />
        </div>
        <button
          type="button"
          disabled={!adding || create.isPending}
          onClick={() => {
            if (!adding) return;
            const person = directory.find((p: { email?: string }) => p.email === adding);
            create.mutate({
              email: adding,
              displayName: person?.displayName ?? "",
              roles: ["report manager"],
              note: "",
            });
            setAdding(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
        >
          <UserPlus className="h-4 w-4" />
          Add as report manager
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface/60 px-4 py-8 text-center text-sm text-fg-muted">
          Nobody has been given a role yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {entries.map((entry) => {
            const isMe = matchesAnyEmail(myEmails, entry.email);
            const notAnEmail = !looksLikeEmail(entry.email);
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-fg">
                      {entry.displayName || entry.email}
                    </span>
                    {isMe && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                        You
                      </span>
                    )}
                  </div>
                  <span className="block truncate text-xs text-fg-muted">{entry.email}</span>
                  {/* A name in this column grants nothing silently, so say so. */}
                  {notAnEmail && (
                    <span className="text-xs text-cooper-red">
                      Not an email address — this row grants nothing. Matching is done on
                      the mailbox, never a name.
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {OPEN_ORDERS_ROLES.map((role) => {
                    const on = entry.roles.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() =>
                          toggle(entry.id, entry.email, entry.displayName, entry.note, entry.roles, role)
                        }
                        title={ROLE_GATES[role]}
                        aria-pressed={on}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          on
                            ? "border-cooper-green/40 bg-cooper-green/10 text-cooper-green"
                            : "border-border bg-surface-2 text-fg-muted hover:text-fg",
                        )}
                      >
                        {ROLE_LABELS[role]}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Remove ${entry.displayName || entry.email}?`)) {
                        remove.mutate(entry.id);
                      }
                    }}
                    aria-label={`Remove ${entry.displayName || entry.email}`}
                    className="rounded p-1.5 text-fg-muted transition-colors hover:bg-cooper-red/10 hover:text-cooper-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
