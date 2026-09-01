import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, Mail, ShieldCheck } from "lucide-react";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { LoadingTasks } from "@/components/LoadingTasks";
import { auditRecipientList, suggestionsFor, type AuditedList } from "@/lib/recipientAudit";
import {
  EIR_RESPONSE_ACCEPTED_ALERTS,
  EIR_TRIAGE_ASSIGNERS,
  EIR_TRIAGE_PROJECT_REVIEWERS,
  COST_IMPACT_NOTICE_ALERTS,
  FAIT_NEW_ALERTS,
  FAIT_SQE_REVIEWERS,
  GRAY_MARKET_NEW_REQUEST_ALERTS,
  SHARED_MAILBOX,
} from "@/api/config";
import { cn } from "@/lib/cn";

// =============================================================================
// Admin → Notification recipients.
//
// Built after Glenn Terry didn't receive an alert that Ray received from the
// same send (2026-08-25). The list and the trigger were both right; what nobody
// could see was whether the ADDRESS was. Mail goes out one sendMail per
// recipient, Graph accepts a message for a mailbox that doesn't exist, and the
// bounce lands in the shared mailbox that nobody reads — so a wrong address in
// one of these lists is silent for ever.
//
// This screen is the missing feedback: every configured list, every address,
// and whether the tenant directory actually has a mailbox at it.
// =============================================================================

/** Every configured recipient list, in the order somebody would look for them. */
const LISTS: Array<{ label: string; envVar: string; value: string | undefined; what: string }> = [
  {
    label: "EIR — add a project reference",
    envVar: "VITE_EIR_TRIAGE_PROJECT_REVIEWERS",
    value: EIR_TRIAGE_PROJECT_REVIEWERS,
    what: "Emailed when an EIR is raised with no project reference.",
  },
  {
    label: "EIR — assign an engineer",
    envVar: "VITE_EIR_TRIAGE_ASSIGNERS",
    value: EIR_TRIAGE_ASSIGNERS,
    what: "Emailed when a project reference lands on an EIR that still has no engineer. Also the fallback when a rejected response has no engineer to send back to.",
  },
  {
    label: "EIR — response accepted",
    envVar: "VITE_EIR_RESPONSE_ACCEPTED_ALERTS",
    value: EIR_RESPONSE_ACCEPTED_ALERTS,
    what: "Emailed when an EIR's status becomes Response Accepted, asking for it to be closed.",
  },
  {
    label: "Gray Market — new request",
    envVar: "VITE_GRAY_MARKET_NEW_REQUEST_ALERTS",
    value: GRAY_MARKET_NEW_REQUEST_ALERTS,
    what: "Emailed when a gray market request is raised.",
  },
  {
    // Shipped 2026-08-27 without a LISTS entry — the exact gap this screen
    // exists to catch, and the second time it has happened (the FAIT alerts
    // did the same). A recipient list nobody audits is where a wrong address
    // goes unnoticed for ever: Graph accepts mail for a mailbox that does not
    // exist, the bounce lands in a shared mailbox nobody reads, and
    // saveToSentItems is off, so there is not even a sent copy.
    label: "Cost Impact Notice — new notice",
    envVar: "VITE_COST_IMPACT_NOTICE_ALERTS",
    value: COST_IMPACT_NOTICE_ALERTS,
    what: "Emailed when a cost impact notice is raised.",
  },
  {
    label: "FAIT — new FAIT",
    envVar: "VITE_FAIT_NEW_ALERTS",
    value: FAIT_NEW_ALERTS,
    what: "Emailed when a FAIT is raised.",
  },
  {
    label: "FAIT — SQE sign-off",
    envVar: "VITE_FAIT_SQE_REVIEWERS",
    value: FAIT_SQE_REVIEWERS,
    what: "Emailed when a FAIT reaches This is with SQE, asking for the SQE sign-off. Also the fallback when a sign-off is approved and there is no engineer or KAM to ask next.",
  },
];

export function AdminNotificationRecipientsView() {
  const { isAdmin, isResolving } = useAdminAccess();
  const directory = useDirectoryPeople();

  const audited = useMemo<AuditedList[]>(
    () =>
      directory.length === 0
        ? []
        : LISTS.map((l) => auditRecipientList(l.label, l.envVar, l.value, directory)),
    [directory],
  );

  if (isResolving) return <LoadingTasks />;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-fg-muted" />
        <h1 className="mt-3 font-display text-lg font-semibold text-fg">Admins only</h1>
      </div>
    );
  }

  const problems = audited.flatMap((l) => l.recipients.filter((r) => r.status !== "matched"));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/admin/admins"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Admin
        </Link>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
          <Mail className="h-5 w-5 text-accent" />
          Notification recipients
        </h1>
        <p className="max-w-3xl text-sm text-fg-muted">
          Who ARC emails for each alert, checked against the staff directory. An
          address with no mailbox behind it fails <em>silently</em>: mail goes out one
          recipient at a time, the send is accepted whether or not the address exists,
          and the bounce goes to{" "}
          <span className="font-mono text-xs">{SHARED_MAILBOX ?? "the shared mailbox"}</span>,
          which nobody reads.
        </p>
      </header>

      {directory.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface/60 px-4 py-8 text-center text-sm text-fg-muted">
          Loading the staff directory… addresses can't be checked until it arrives.
        </p>
      ) : (
        <>
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
              problems.length === 0
                ? "border-cooper-green/40 bg-cooper-green/5"
                : "border-cooper-red/30 bg-cooper-red/5",
            )}
          >
            {problems.length === 0 ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-cooper-green" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cooper-red" />
            )}
            <span className="text-fg-muted">
              {problems.length === 0 ? (
                <>
                  <span className="font-medium text-fg">
                    Every configured address has a mailbox.
                  </span>{" "}
                  If somebody still isn't receiving an alert, the address isn't the
                  reason — check their junk folder, whether the trigger actually fired,
                  and whether they were the person who made the change (nobody is
                  notified of their own action).
                </>
              ) : (
                <>
                  <span className="font-medium text-fg">
                    {problems.length} address{problems.length === 1 ? "" : "es"} with no
                    mailbox in the directory.
                  </span>{" "}
                  Mail to {problems.length === 1 ? "it" : "them"} is accepted and then
                  bounces where nobody sees it.
                </>
              )}
            </span>
          </div>

          {audited.map((list, i) => (
            <section key={list.envVar} className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg">
                  {list.label}
                </h2>
                <p className="text-xs text-fg-muted">{LISTS[i].what}</p>
              </div>

              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {list.recipients.length === 0 && (
                  <li className="px-4 py-3 text-sm text-fg-muted">
                    Nobody configured — this alert reaches no one.
                  </li>
                )}
                {list.recipients.map((r) => {
                  const suggestions = suggestionsFor(r, directory);
                  return (
                    <li key={r.configured} className="flex items-start gap-3 px-4 py-3">
                      {r.status === "matched" ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-cooper-green" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cooper-red" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-medium text-fg">
                            {r.matched?.displayName || r.displayName}
                          </span>
                          <span className="font-mono text-xs text-fg-muted">
                            {r.email || r.configured}
                          </span>
                        </div>
                        {r.status === "not-an-email" && (
                          <span className="text-xs text-cooper-red">
                            Not an email address — this entry reaches nobody.
                          </span>
                        )}
                        {r.status === "not-in-directory" && (
                          <span className="block text-xs text-cooper-red">
                            No mailbox in the directory at this address.
                            {suggestions.length > 0 && (
                              <>
                                {" "}
                                Did you mean{" "}
                                {suggestions.map((p, j) => (
                                  <span key={p.email ?? j}>
                                    {j > 0 && " or "}
                                    <span className="font-mono">{p.email}</span>
                                  </span>
                                ))}
                                ?
                              </>
                            )}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <p className="text-xs text-fg-muted">
                Change it with the repo variable{" "}
                <span className="font-mono text-[11px]">{list.envVar}</span> — comma
                separated, <span className="font-mono text-[11px]">Name &lt;email&gt;</span>{" "}
                or a bare address. It only takes effect on the next deploy.
              </p>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
