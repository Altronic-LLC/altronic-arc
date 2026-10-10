import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock, Pencil, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { QUOTE_ROLES, type QuoteRole, type QuoteRoleEntry } from "@/types/quote";
import {
  useCreateQuoteRoleEntry,
  useDeleteQuoteRoleEntry,
  useMyQuoteAccess,
  useQuoteRoleEntries,
  useUpdateQuoteRoleEntry,
} from "@/hooks/useQuoteRoles";
import { useCurrentUserEmails } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { manageRolesGate } from "@/lib/quoteRoles";
import { looksLikeEmail, matchesAnyEmail } from "@/lib/emailIdentity";
import { personKey } from "@/lib/people";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { useSortableTable } from "@/hooks/useSortableTable";
import type { SortColumn } from "@/lib/tableSort";
import { SortableHeader } from "@/components/SortableTableHeader";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SingleSelect } from "@/components/SearchableSelect";
import { QuotesNav } from "@/components/QuotesNav";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";

// =============================================================================
// Insourcing Quotes → Roles. Who may see and work quotes.
//
// Managed by a quote MANAGER or an ARC admin (`manageRolesGate`) — the admin
// half is what stops a list nobody holds `manager` on from being a door locked
// from the inside. An ARC admin is NOT given quote access by managing this
// list; they would add themselves like anybody else.
//
// NO ROLE = NO ACCESS. And hiding cost from a viewer is UI-only: SharePoint's
// list permissions are the real boundary, which the legend says plainly.
// =============================================================================

export const QUOTE_ROLE_LABELS: Record<QuoteRole, string> = {
  viewer: "Viewer",
  quoter: "Quoter",
  manager: "Manager",
};

export const QUOTE_ROLE_DESCRIPTIONS: Record<QuoteRole, string> = {
  viewer:
    "Sees quotes, assemblies, components and sell prices; comments and attaches. Edits nothing, and never sees cost or margin.",
  quoter:
    "Everything a viewer can, plus creates and edits quotes, assemblies and components, enters cost and target margin, generates the customer PDF and makes new revisions.",
  manager:
    "Everything a quoter can, plus adds and edits customers, manages this roles list, and marks quotes Won, Lost or Expired.",
};

export const QUOTE_ROLE_COLUMNS: SortColumn<QuoteRoleEntry>[] = [
  { key: "name", label: "Name", value: (e) => e.displayName || e.email },
  { key: "email", label: "Email", value: (e) => e.email, noFilter: true },
  {
    key: "roles",
    label: "Roles",
    value: (e) => e.roles.map((r) => QUOTE_ROLE_LABELS[r]).join(", "),
  },
  { key: "note", label: "Note", value: (e) => e.note, noFilter: true },
];

export function QuoteRolesView() {
  const access = useMyQuoteAccess();
  const gate = manageRolesGate(access);

  if (!access.configured) {
    return (
      <Shell>
        <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 p-3 text-sm text-fg">
          <span className="font-semibold text-ajax-yellow">Quote Roles list not configured.</span> Run{" "}
          <code>scripts/create-quote-lists.ps1</code> to create it, then set{" "}
          <code>VITE_SP_QUOTE_ROLES_LIST_ID</code> and redeploy. Until then nobody holds a quote role and
          this page can't store changes.
        </div>
      </Shell>
    );
  }
  if (gate.resolving) {
    return (
      <Shell>
        <LoadingTasks noun="quote roles" />
      </Shell>
    );
  }
  if (!gate.allowed) {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
          <Lock className="mx-auto h-8 w-8" />
          <p className="mt-3 font-medium text-fg">You can't manage quote roles.</p>
          <p className="mt-1">{gate.hint}</p>
        </div>
      </Shell>
    );
  }
  return <RolesManager />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <QuotesNav />
      {children}
    </div>
  );
}

function RoleChip({ role }: { role: QuoteRole }) {
  return (
    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
      {QUOTE_ROLE_LABELS[role]}
    </span>
  );
}

function RolesManager() {
  const myEmails = useCurrentUserEmails();
  const { data: entries = [], isLoading, error, refetch } = useQuoteRoleEntries();
  const remove = useDeleteQuoteRoleEntry();
  // undefined = closed, null = add, a row = edit.
  const [editing, setEditing] = useState<QuoteRoleEntry | null | undefined>(undefined);
  const listUnavailable = !!error && isPermissionDenied(error);

  const table = useSortableTable<QuoteRoleEntry>({
    rows: entries,
    columns: QUOTE_ROLE_COLUMNS,
    stableKey: (e) => e.id,
    initialKey: "name",
  });

  return (
    <Shell>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Quote roles</h1>
            <p className="text-sm text-fg-muted">
              Who can see and work Insourcing Quotes. Anyone not listed here has no access.
            </p>
          </div>
        </div>
        <div>
          <button
            onClick={() => setEditing(null)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
          >
            <UserPlus className="h-4 w-4" /> Add person
          </button>
        </div>
      </header>

      <div className="rounded-lg border border-border bg-surface-2/40 p-3">
        <h2 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          What each role allows
        </h2>
        <ul className="flex flex-col gap-1.5 text-xs text-fg">
          {QUOTE_ROLES.map((role) => (
            <li key={role} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{QUOTE_ROLE_LABELS[role]}</span>
              <span className="text-fg-muted">{QUOTE_ROLE_DESCRIPTIONS[role]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-fg-muted">
          Each role includes the ones above it. ARC admins can manage this list but get no quote access
          from that. Hiding cost from viewers is done in ARC only — SharePoint's own list permissions are
          the real boundary.
        </p>
      </div>

      {isLoading ? (
        <LoadingTasks noun="quote roles" />
      ) : listUnavailable ? (
        <ListAccessNotice list="Quote Roles" site="Altronic_PMO" onRetry={() => void refetch()} />
      ) : error ? (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't load the Quote Roles list: {(error as Error).message}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          Nobody has a quote role yet. Click "Add person" to start.
        </div>
      ) : (
        <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                {QUOTE_ROLE_COLUMNS.map((column) => (
                  <SortableHeader key={column.key} label={column.label} {...table.headerProps(column.key)} />
                ))}
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((e) => {
                const name = e.displayName || e.email;
                return (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-4 py-2 font-medium text-fg">
                      {name}
                      {matchesAnyEmail(myEmails, e.email) && (
                        <span className="ml-2 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          you
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-fg-muted">
                      {e.email}
                      {!looksLikeEmail(e.email) && (
                        <span
                          className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-amber-700 dark:text-amber-400"
                          title="Roles are matched on email address. Until this is an address, this row grants nothing."
                        >
                          not an email
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {e.roles.length ? (
                          e.roles.map((r) => <RoleChip key={r} role={r} />)
                        ) : (
                          <span className="text-xs italic text-fg-muted">none — no access</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-fg-muted">{e.note || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(e)}
                        aria-label={`Edit ${name}`}
                        className="mr-1 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Remove ${name} from Quote Roles? They lose access to Insourcing Quotes.`)) {
                            remove.mutate(e.id);
                          }
                        }}
                        disabled={remove.isPending}
                        aria-label={`Remove ${name}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg-muted transition-colors hover:border-cooper-red hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {remove.error && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't remove that person: {(remove.error as Error).message}
        </div>
      )}

      {editing !== undefined && (
        <QuoteRoleModal entry={editing} entries={entries} onClose={() => setEditing(undefined)} />
      )}
    </Shell>
  );
}

function QuoteRoleModal({
  entry,
  entries,
  onClose,
}: {
  entry: QuoteRoleEntry | null;
  entries: QuoteRoleEntry[];
  onClose: () => void;
}) {
  const editing = entry !== null;
  const create = useCreateQuoteRoleEntry();
  const update = useUpdateQuoteRoleEntry();
  const pending = create.isPending || update.isPending;
  const directory = useDirectoryPeople();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [name, setName] = useState(entry?.displayName ?? "");
  const [roles, setRoles] = useState<QuoteRole[]>(entry?.roles ?? []);
  const [note, setNote] = useState(entry?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);
  const overlayDismiss = useOverlayDismiss(onClose, pending);

  // A second row for the same person would be silently ignored (the first
  // match wins), so they aren't offered again.
  const alreadyListed = useMemo(() => new Set(entries.map((e) => e.email.trim().toLowerCase())), [entries]);
  const options = useMemo(
    () =>
      directory
        .filter((p) => p.email && !alreadyListed.has(p.email.toLowerCase()))
        .map((p) => ({ value: personKey(p), label: `${p.displayName} — ${p.email}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [directory, alreadyListed],
  );
  const picked = useMemo(() => directory.find((p) => personKey(p) === selectedKey) ?? null, [directory, selectedKey]);

  const email = editing
    ? entry.email
    : manual
      ? manualEmail.trim().toLowerCase()
      : (picked?.email ?? "").toLowerCase();
  const displayName = editing || manual ? name.trim() : (picked?.displayName ?? "");
  const duplicate = !editing && !!email && alreadyListed.has(email);
  const canSubmit = !!email && !duplicate && roles.length > 0 && !pending;

  function toggle(role: QuoteRole) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({ id: entry.id, displayName, roles, note: note.trim() });
      } else {
        await create.mutateAsync({ email, displayName, roles, note: note.trim() });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save — please retry.");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit quote role" : "Add person to Quote Roles"}
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">
            {editing ? `Edit ${entry.displayName || entry.email}` : "Add person to Quote Roles"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Email</span>
                <span className="font-mono text-sm text-fg">{entry.email}</span>
              </div>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Name</span>
                <input type="text" value={name} onChange={(ev) => setName(ev.target.value)} className="input" />
              </label>
            </>
          ) : !manual ? (
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
                  value={manualEmail}
                  onChange={(ev) => setManualEmail(ev.target.value)}
                  placeholder="someone@altronic-llc.com"
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Name</span>
                <input type="text" value={name} onChange={(ev) => setName(ev.target.value)} className="input" />
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
              That person is already on the list — edit their row instead.
            </div>
          )}

          <fieldset className="flex flex-col gap-1.5 text-xs">
            <legend className="mb-1 font-semibold uppercase tracking-wider text-fg-muted">Roles</legend>
            {QUOTE_ROLES.map((role) => (
              <label key={role} className="flex items-start gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={() => toggle(role)}
                  className="mt-1 h-3.5 w-3.5 accent-accent"
                />
                <span>
                  {QUOTE_ROLE_LABELS[role]}
                  <span className="block text-[11px] text-fg-muted">{QUOTE_ROLE_DESCRIPTIONS[role]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Note (optional)</span>
            <input type="text" value={note} onChange={(ev) => setNote(ev.target.value)} className="input" />
          </label>

          {error && (
            <div role="alert" className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-2 py-1.5 text-xs text-cooper-red">
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
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? "Save" : "Add person"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
