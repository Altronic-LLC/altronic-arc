import { useState } from "react";
import { useParams } from "react-router-dom";
import { Ban, CheckCircle2, Circle, ExternalLink, Loader2, Pencil, RotateCcw, UserPlus } from "lucide-react";
import { useNewHire, useSetNewHireCancelled, useSetNewHireStep } from "@/hooks/useNewHires";
import { NEW_HIRE_STEP_LABELS, type NewHire, type NewHireStep } from "@/types/hr";
import { applicableSteps, isOpenNewHire, safeTicketLink, startDateLabel, startLabel, stepProgress } from "@/lib/newHire";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { NewHireFormModal } from "@/components/NewHireFormModal";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { HrAccessGate, HrCardTitle, HrDialog, HrField, NewHireStatusChip } from "@/components/hrAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// One new hire (/hr/new-hires/:id). The page READS; Edit opens the whole form
// (anyone with access edits everything). The kick-off checklist on the right
// is the workflow: each tick stamps who and when, the status follows the
// ticks, and the last tick tells the submitter and the manager the hire is
// ready. Cancelling needs a reason and tells SAP, IT and the manager.
// =============================================================================

export function NewHireDetailView() {
  return (
    <HrAccessGate app="newHire">
      <NewHireDetail />
    </HrAccessGate>
  );
}

function when(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function NewHireDetail() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const { data: hire, isLoading, error, refetch } = useNewHire(Number.isFinite(id) ? id : null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (isLoading) return <LoadingTasks noun="the new hire" />;
  if (error) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <DetailTopBar category="New Hires" listTo="/hr/new-hires" />
        {isPermissionDenied(error) ? (
          <ListAccessNotice list="New Hires" site="the HR site" onRetry={() => void refetch()} />
        ) : (
          <p className="text-sm text-cooper-red">Couldn't load the new hire: {error instanceof Error ? error.message : "unknown error"}</p>
        )}
      </div>
    );
  }
  if (!hire) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <DetailTopBar category="New Hires" listTo="/hr/new-hires" />
        <p className="text-sm text-fg-muted">That new hire wasn't found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1300px] px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="New Hires" listTo="/hr/new-hires" />
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <UserPlus className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold leading-tight text-fg sm:text-2xl">
              {hire.displayName || `New hire #${hire.id}`}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <NewHireStatusChip status={hire.status} />
              {[hire.jobTitle, hire.department].filter(Boolean).join(" · ")}
              {isOpenNewHire(hire) && hire.startDate && <span>· {startLabel(hire.startDate, new Date())}</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
          <CancelOrReopen hire={hire} onCancel={() => setCancelling(true)} />
        </div>
      </header>

      {hire.cancelled && (
        <div className="mb-4 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm">
          <span className="font-medium text-fg">Cancelled</span>{" "}
          <span className="text-fg-muted">
            by {hire.cancelled.by.displayName} on {when(hire.cancelled.at)}
            {hire.cancelled.reason ? ` — ${hire.cancelled.reason}` : ""}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <Card title="Person">
            <Row label="Legal first name" value={hire.legalFirstName} />
            <Row label="Preferred first name" value={hire.preferredFirstName} />
            <Row label="Last name" value={hire.lastName} />
            <Row label="Display name" value={hire.displayName} />
            <Row label="Email" value={hire.email} />
          </Card>
          <Card title="Job">
            <Row label="Start date" value={startDateLabel(hire.startDate)} />
            <Row label="Job title" value={hire.jobTitle} />
            <Row label="Department" value={hire.department} />
            <Row label="Type" value={hire.employmentType ?? ""} />
            <Row label="Manager" value={hire.manager ? `${hire.manager.displayName} (${hire.manager.email ?? ""})` : ""} />
            <Row label="FAB number" value={hire.fabNumber} />
            <Row label="Personal #" value={hire.personalNumber} />
            <Row label="EMP number" value={hire.empNumber} />
          </Card>
          <Card title="Equipment and IT">
            <Row label="Computer needed" value={hire.needsComputer === null ? "" : hire.needsComputer ? "Yes" : "No"} />
            <Row label="Desk location" value={hire.deskLocation} />
            <Row label="Cooper IT ticket #" value={hire.itTicketNumber} />
            <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-2 py-1 text-sm">
              <span className="text-fg-muted">Ticket link</span>
              <TicketLink value={hire.itTicketLink} />
            </div>
          </Card>
          <Card title="Additional notes">
            <p className="whitespace-pre-wrap text-sm text-fg">{hire.notes || <span className="text-fg-muted">None</span>}</p>
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <Checklist hire={hire} />
          <section className="rounded-xl border border-border bg-surface p-4 text-sm">
            <HrCardTitle>Record</HrCardTitle>
            <p className="mt-2 text-fg-muted">
              Submitted{hire.submittedBy ? ` by ${hire.submittedBy.displayName}` : ""}
              {hire.createdAt ? ` on ${when(hire.createdAt)}` : ""}.
            </p>
          </section>
        </aside>
      </div>

      {editing && <NewHireFormModal hire={hire} onClose={() => setEditing(false)} />}
      {cancelling && <CancelDialog hire={hire} onClose={() => setCancelling(false)} />}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <HrCardTitle>{title}</HrCardTitle>
      <div className="mt-2 divide-y divide-border">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-2 py-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="break-words text-fg">{value.trim() || <span className="text-fg-muted">—</span>}</span>
    </div>
  );
}

function TicketLink({ value }: { value: string }) {
  if (!value.trim()) return <span className="text-fg-muted">—</span>;
  const href = safeTicketLink(value);
  if (!href) return <span className="break-words text-fg">{value}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-accent hover:underline">
      Open ticket <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Checklist({ hire }: { hire: NewHire }) {
  const setStep = useSetNewHireStep();
  const steps = applicableSteps(hire);
  const { done, total } = stepProgress(hire);
  const locked = !!hire.cancelled;
  const pending = setStep.isPending ? setStep.variables?.step : undefined;

  function toggle(step: NewHireStep) {
    if (locked) return;
    setStep.mutate({ id: hire.id, step, done: hire.steps[step] === null });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <HrCardTitle>Kick-off</HrCardTitle>
        <span className="text-xs tabular-nums text-fg-muted">
          {done} of {total} done
        </span>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {locked
          ? "Cancelled — reopen it to tick steps."
          : "Tick each step as it's done. The last tick tells the submitter and the manager everything is ready."}
      </p>
      <ul className="mt-3 flex flex-col gap-1">
        {steps.map((step) => {
          const stamp = hire.steps[step];
          return (
            <li key={step}>
              <button
                type="button"
                role="checkbox"
                aria-checked={stamp !== null}
                aria-disabled={locked || undefined}
                onClick={() => toggle(step)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  locked ? "cursor-not-allowed opacity-60" : "hover:bg-surface-2",
                )}
              >
                {pending === step ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-fg-muted" />
                ) : stamp ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cooper-green" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
                )}
                <span className="min-w-0">
                  <span className="block text-sm text-fg">{NEW_HIRE_STEP_LABELS[step]}</span>
                  {stamp && (
                    <span className="block text-[11px] text-fg-muted">
                      {stamp.by.displayName}, {when(stamp.at)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {hire.needsComputer === false && (
          <li className="px-2 py-1.5 text-[11px] text-fg-muted">Computer set up — not needed.</li>
        )}
      </ul>
    </section>
  );
}

function CancelOrReopen({ hire, onCancel }: { hire: NewHire; onCancel: () => void }) {
  const setCancelled = useSetNewHireCancelled();
  if (hire.cancelled) {
    return (
      <button
        type="button"
        disabled={setCancelled.isPending}
        onClick={() => setCancelled.mutate({ id: hire.id, reason: null })}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
      >
        <RotateCcw className="h-4 w-4" />
        Reopen
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onCancel}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-cooper-red hover:bg-cooper-red/10"
    >
      <Ban className="h-4 w-4" />
      Cancel hire
    </button>
  );
}

function CancelDialog({ hire, onClose }: { hire: NewHire; onClose: () => void }) {
  const setCancelled = useSetNewHireCancelled();
  const [reason, setReason] = useState("");
  return (
    <HrDialog
      title={`Cancel ${hire.displayName}`}
      subtitle="The people setting them up in SAP and IT, and the manager, are emailed to stop."
      busy={setCancelled.isPending}
      onClose={onClose}
      submitLabel="Cancel the new hire"
      submitDisabled={!reason.trim()}
      onSubmit={() => setCancelled.mutate({ id: hire.id, reason }, { onSuccess: onClose })}
    >
      <HrField label="Reason" required>
        <AutoGrowTextarea
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Offer declined"
          style={{ minHeight: "4rem" }}
          autoFocus
        />
      </HrField>
    </HrDialog>
  );
}
