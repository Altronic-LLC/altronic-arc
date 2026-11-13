import { useMemo, useState } from "react";
import { BellRing, Lock, Plus, X } from "lucide-react";
import {
  HARNESS_ALERTS_CONFIGURED,
  useAddHarnessAlertRecipient,
  useHarnessAlertRecipients,
  useRemoveHarnessAlertRecipient,
} from "@/hooks/useHarnessAlertRecipients";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { DetailTopBar } from "@/components/DetailTopBar";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SingleSelect } from "@/components/SearchableSelect";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { HARNESS_ALERTS, type HarnessAlert, type HarnessAlertRecipient } from "@/types/harness";

// =============================================================================
// Harness → Who's notified (Tim, 2026-10-27). Who each Harness email goes to,
// kept on the Harness Alert Recipients list so changing it needs no redeploy.
// Everyone can see it; ARC admins add and remove people. People are PICKED
// from the staff directory, never typed, so an address can't be misspelt —
// Graph accepts mail for a mailbox that doesn't exist, and nobody would know.
// =============================================================================

const WHAT: Record<HarnessAlert, string> = {
  "Crimp out of spec": "Emailed when a crimp height check has any reading outside its spec.",
  "Part number request":
    "Emailed when somebody asks for a harness part number that isn't on the list, or is retired.",
};

export function HarnessAlertRecipientsView() {
  const { data: recipients = [], isLoading, error, refetch } = useHarnessAlertRecipients();
  const { isAdmin, isResolving } = useAdminAccess();
  const lockHint = isResolving ? "Checking your access…" : "Only ARC admins can change who is notified.";

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Harness" listTo="/harness/crimp-checks" />
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Who's notified</h1>
          <p className="text-xs text-fg-muted">
            Who the Harness department's emails go to. Changes apply to the next email.
          </p>
        </div>
      </header>

      {!isAdmin && (
        <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
          <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{lockHint}</span>
        </p>
      )}

      {!HARNESS_ALERTS_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          The Harness Alert Recipients list isn't set up yet, so nobody is emailed. It's created by
          <code className="mx-1 font-mono text-xs">scripts/create-crimp-lists.ps1</code>
          and its id goes in the <code className="font-mono text-xs">VITE_SP_HARNESS_ALERT_RECIPIENTS_LIST_ID</code> repo
          variable — set once, then people are managed here.
        </div>
      ) : error && isPermissionDenied(error) ? (
        <ListAccessNotice list="Harness Alert Recipients" site="Altronic_PMO" onRetry={() => void refetch()} />
      ) : error ? (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't load who's notified: {(error as Error).message}{" "}
          <button onClick={() => void refetch()} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <LoadingTasks noun="who's notified" />
      ) : (
        HARNESS_ALERTS.map((alert) => (
          <AlertCard
            key={alert}
            alert={alert}
            people={recipients.filter((r) => r.alert === alert)}
            canEdit={isAdmin}
            lockHint={lockHint}
          />
        ))
      )}
    </div>
  );
}

function AlertCard({
  alert,
  people,
  canEdit,
  lockHint,
}: {
  alert: HarnessAlert;
  people: HarnessAlertRecipient[];
  canEdit: boolean;
  lockHint: string;
}) {
  const directory = useDirectoryPeople();
  const add = useAddHarnessAlertRecipient();
  const remove = useRemoveHarnessAlertRecipient();
  const [picked, setPicked] = useState<string | null>(null);

  const options = useMemo(() => {
    const on = new Set(people.map((p) => p.email.toLowerCase()));
    return directory
      .filter((p) => p.email && !on.has(p.email.toLowerCase()))
      .map((p) => ({ value: p.email!, label: `${p.displayName} — ${p.email}` }));
  }, [directory, people]);

  async function handleAdd() {
    const person = directory.find((p) => p.email === picked);
    if (!person?.email) return;
    await add.mutateAsync({ name: person.displayName, email: person.email, alert }).catch(() => undefined);
    setPicked(null);
  }

  return (
    <section aria-label={alert} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div>
        <h2 className="font-display text-base font-semibold text-fg">{alert}</h2>
        <p className="text-xs text-fg-muted">{WHAT[alert]}</p>
      </div>

      {people.length === 0 ? (
        <p className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-3 py-2 text-xs text-fg">
          Nobody yet — this email goes to no one.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-fg">{p.name}</span>{" "}
                <span className="text-xs text-fg-muted">{p.email}</span>
              </span>
              <button
                onClick={() => remove.mutate(p.id)}
                disabled={!canEdit || remove.isPending}
                title={canEdit ? `Stop emailing ${p.name}` : lockHint}
                aria-label={`Remove ${p.name} from ${alert}`}
                className="rounded-sm p-1 text-fg-muted hover:bg-surface-2 hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <SingleSelect
              allLabel="Pick a person to add"
              searchPlaceholder="Search the staff directory…"
              ariaLabel={`Add someone to ${alert}`}
              options={options}
              selected={picked}
              onChange={setPicked}
              disabled={add.isPending}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!picked || add.isPending}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      )}
    </section>
  );
}
