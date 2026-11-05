import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2, Pencil, Send, Users, X } from "lucide-react";
import type { Ecn } from "@/types/task";
import { ecnDistributionAvailable } from "@/api/ecns";
import { ecnDistributionGroupsConfigured } from "@/api/ecnDistributionGroups";
import {
  canSendDistributionNow,
  ecnDistributionRecipients,
  emptyDistributionRoles,
} from "@/lib/ecnDistribution";
import { ecnDistributionPatch } from "@/lib/ecnMapper";
import { useSendEcnDistribution, useUpdateEcnFields } from "@/hooks/useEcns";
import { useEcnDistributionGroups } from "@/hooks/useEcnDistributionGroups";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { EcnDistributionChecklist } from "./EcnDistributionChecklist";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// An ECN's DISTRIBUTION block (BusinessIT#57).
//
// Shows the ticked roles and who each reaches, whether it has been sent, and
// who to. It is SENT the first time Sign-off status is filled in (useEcns.ts);
// this card says so before that happens, warns about a ticked role nobody is
// set up for, and offers Send now when the sign-off is in but nothing went
// (nobody was set up then, the send failed, or the ECN predates this).
//
// Read-only on the page; the Edit button opens the tick boxes — the house rule
// for detail pages. Any signed-in user can change the ticks, like every other
// ECN field.
// =============================================================================

export function EcnDistributionCard({ ecn }: { ecn: Ecn }) {
  const { data: groups = [], isLoading, error } = useEcnDistributionGroups();
  const send = useSendEcnDistribution();
  const { isAdmin } = useAdminAccess();
  const [editing, setEditing] = useState(false);

  if (!ecnDistributionAvailable()) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <CardHeading />
        <p className="text-sm text-fg-muted">
          Distribution isn't set up on the ECN list yet. An admin runs scripts/create-ecn-distribution.ps1 to add it.
        </p>
      </section>
    );
  }

  const configured = ecnDistributionGroupsConfigured();
  const recipients = ecnDistributionRecipients(groups, ecn.distribution);
  const empty = configured && !isLoading && !error ? emptyDistributionRoles(groups, ecn.distribution) : [];
  const signedOff = !!ecn.values.signOffStatus?.trim();

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" data-testid="ecn-distribution">
      <CardHeading>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit Distribution"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      </CardHeading>

      {ecn.distributedAt ? (
        <p className="mb-3 text-sm text-fg">
          Sent {ecn.distributedAt.toLocaleDateString()} to{" "}
          {ecn.distributedTo.length > 0
            ? ecn.distributedTo.map((p) => p.displayName || p.email).join(", ")
            : "nobody"}
          .
        </p>
      ) : signedOff ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="text-sm text-fg">Signed off, but not sent to its distribution yet.</p>
          {canSendDistributionNow(ecn) && (
            <button
              type="button"
              onClick={() => send.mutate(ecn.id)}
              disabled={send.isPending || ecn.distribution.length === 0}
              title={ecn.distribution.length === 0 ? "Tick at least one role first" : undefined}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {send.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send now
            </button>
          )}
        </div>
      ) : (
        <p className="mb-3 text-[11px] text-fg-muted">
          Emailed to everyone below the first time Sign-off status is filled in.
        </p>
      )}

      {ecn.distribution.length === 0 ? (
        <p className="text-sm text-fg-muted">No roles ticked — nobody will be emailed.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {ecn.distribution.map((role) => {
            const people = recipients.filter((r) => r.roles.some((x) => x.toLowerCase() === role.toLowerCase()));
            return (
              <li key={role} className="grid grid-cols-1 gap-0.5 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
                <span className="font-medium text-fg">{role}</span>
                <span className={people.length ? "text-fg-muted" : "italic text-fg-muted"}>
                  {!configured || isLoading || error
                    ? "—"
                    : people.length
                      ? people.map((p) => p.displayName || p.email).join(", ")
                      : "Nobody set up"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {!configured ? (
        <p className="mt-3 text-[11px] text-cooper-red">
          ECN distribution groups aren't set up yet (VITE_SP_ECN_DISTRIBUTION_GROUPS_LIST_ID), so nothing can be emailed.
        </p>
      ) : error ? (
        <p className="mt-3 text-[11px] text-cooper-red">
          Couldn't load the distribution groups: {error instanceof Error ? error.message : "unknown error"}
        </p>
      ) : empty.length > 0 && !ecn.distributedAt ? (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-fg">
          {/* Colour on the icon, never the text — yellow text is unreadable on white. */}
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-ajax-yellow" />
          Nobody is set up for {empty.join(", ")} — {empty.length === 1 ? "that role" : "those roles"} won't be emailed.
        </p>
      ) : null}

      {isAdmin && (
        <Link
          to="/engineering/ecns/distribution"
          className="mt-3 inline-flex items-center gap-1 text-[11px] text-accent underline-offset-2 hover:underline"
        >
          <Users className="h-3 w-3" />
          Manage distribution groups
        </Link>
      )}

      {editing && <DistributionEditor ecn={ecn} onClose={() => setEditing(false)} />}
    </section>
  );
}

function CardHeading({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Distribution</h2>
      {children}
    </div>
  );
}

function DistributionEditor({ ecn, onClose }: { ecn: Ecn; onClose: () => void }) {
  const update = useUpdateEcnFields();
  const { data: groups = [] } = useEcnDistributionGroups();
  // Seeded once — a refetch behind the dialog must not wipe the ticks.
  const [ticked, setTicked] = useState<string[]>(() => [...ecn.distribution]);
  const overlayDismiss = useOverlayDismiss(onClose, false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    const same =
      ticked.length === ecn.distribution.length &&
      ticked.every((r) => ecn.distribution.some((x) => x.toLowerCase() === r.toLowerCase()));
    if (!same) {
      update.mutate({
        id: ecn.id,
        fields: ecnDistributionPatch(ticked),
        patch: (e) => ({ ...e, distribution: [...ticked] }),
      });
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit Distribution"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-semibold text-fg">Edit Distribution</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          {ecn.distributedAt && (
            <p className="mb-3 text-[11px] text-fg-muted">
              This ECN was already sent on {ecn.distributedAt.toLocaleDateString()}. Changing the ticks won't send it again.
            </p>
          )}
          <EcnDistributionChecklist ticked={ticked} onChange={setTicked} groups={groups} idPrefix={`ecn-${ecn.id}-dist`} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-accent/90"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
