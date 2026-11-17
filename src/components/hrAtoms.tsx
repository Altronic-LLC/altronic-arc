import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { Loader2, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { HR_CONFIGURED } from "@/api/config";
import type { Person } from "@/types/task";
import type { NewHireStatus } from "@/types/hr";
import type { HrGate } from "@/lib/hrRoles";
import { manageHrRolesGate, newHireGate } from "@/lib/hrRoles";
import { personKey } from "@/lib/people";
import { useMyHrAccess } from "@/hooks/useHrRoles";
import { SingleSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { LoadingTasks } from "./LoadingTasks";
import { cn } from "@/lib/cn";

// =============================================================================
// Human Resources atoms — the dialog shell, field label, person picker, the
// status chip, the HR sub-nav and the gate every HR screen sits behind. HR's
// own copies: a department never imports another's components.
// =============================================================================

const CHIP = "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium";

const STATUS_TONE: Record<NewHireStatus, string> = {
  Submitted: "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg",
  "In progress": "border-superior-blue/40 bg-superior-blue/10 text-superior-blue",
  Complete: "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
  Cancelled: "border-border bg-surface-2 text-fg-muted",
};

export function NewHireStatusChip({ status }: { status: NewHireStatus }) {
  return <span className={cn(CHIP, STATUS_TONE[status])}>{status}</span>;
}

/** New Hires / Access — Access only for whoever can manage it. */
export function HrNav() {
  const { rights } = useMyHrAccess();
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      isActive ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
    );
  if (!rights.canNewHire && !rights.canManage) return null;
  return (
    <nav aria-label="HR sections" className="flex flex-wrap items-center gap-1 self-start rounded-lg bg-surface-2 p-1">
      {rights.canNewHire && (
        <NavLink to="/hr/new-hires" className={tab}>
          <UserPlus className="h-4 w-4" />
          New Hires
        </NavLink>
      )}
      {rights.canManage && (
        <NavLink to="/hr/access" className={tab}>
          <ShieldCheck className="h-4 w-4" />
          Access
        </NavLink>
      )}
    </nav>
  );
}

/**
 * Every HR screen sits behind this. HR not set up, or no right to the app:
 * a plain notice — the menu and Dashboard never link here for such a person,
 * so they only arrive by a pasted URL.
 */
export function HrAccessGate({ app, children }: { app: "newHire" | "manage"; children: React.ReactNode }) {
  const access = useMyHrAccess();
  if (!HR_CONFIGURED) {
    return (
      <Notice title="Human Resources isn't set up yet">
        HR doesn't have a SharePoint site in ARC yet. Once IT creates it, an admin runs{" "}
        <span className="font-mono text-xs">scripts/create-hr-lists.ps1</span>, sets the ids and redeploys.
      </Notice>
    );
  }
  if (access.resolving) return <LoadingTasks noun="HR access" />;
  const gate: HrGate = app === "newHire" ? newHireGate(access) : manageHrRolesGate(access);
  if (!gate.allowed) return <Notice title="No access">{gate.hint}</Notice>;
  return <>{children}</>;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <Users className="mx-auto h-8 w-8 text-fg-muted" />
        <h1 className="mt-3 font-display text-lg font-semibold text-fg">{title}</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-fg-muted">{children}</p>
      </div>
    </div>
  );
}

/** A section title on a card — the house style. */
export function HrCardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">{children}</h2>;
}

export function HrDialog({
  title,
  subtitle,
  busy,
  onClose,
  submitLabel,
  submitDisabled,
  onSubmit,
  wide,
  footerNote,
  children,
}: {
  title: string;
  subtitle?: string;
  busy?: boolean;
  onClose: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit: () => void;
  wide?: boolean;
  /** Shown to the left of the buttons — e.g. what's still missing. */
  footerNote?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  const overlayDismiss = useOverlayDismiss(onClose, !!busy);
  const formId = `hr-dialog-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-lg border border-border bg-surface shadow-xl",
          wide ? "max-w-3xl" : "max-w-xl",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-fg">{title}</h2>
            {subtitle && <p className="text-[11px] text-fg-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          id={formId}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && !submitDisabled) onSubmit();
          }}
        >
          {children}
        </form>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
          {footerNote && <div className="mr-auto min-w-0 text-[11px] text-fg-muted">{footerNote}</div>}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={busy || submitDisabled}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HrField({
  label,
  required,
  hint,
  className,
  plain,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  /** A <div> instead of a <label> — for controls that label themselves (pills, pickers). */
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Wrapper = plain ? "div" : "label";
  return (
    <Wrapper className={cn("block", className)}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-muted">{hint}</span>}
    </Wrapper>
  );
}

/** One person, picked from a list — never typed. */
export function HrPersonPicker({
  value,
  people,
  onChange,
  ariaLabel,
  emptyLabel = "Not set",
}: {
  value: Person | null;
  people: Person[];
  onChange: (next: Person | null) => void;
  ariaLabel: string;
  emptyLabel?: string;
}) {
  const options = people
    .filter((p) => p.email)
    .map((p) => ({ value: personKey(p), label: p.displayName || p.email! }));
  // The current person stays in the list even if they aren't a candidate —
  // a set value must never read as empty.
  if (value && !options.some((o) => o.value === personKey(value))) {
    options.unshift({ value: personKey(value), label: value.displayName || value.email || "Unknown" });
  }
  return (
    <SingleSelect
      options={options}
      selected={value ? personKey(value) : null}
      onChange={(key) => onChange(key ? (people.find((p) => personKey(p) === key) ?? value) : null)}
      allLabel={emptyLabel}
      ariaLabel={ariaLabel}
      searchPlaceholder="Search people…"
    />
  );
}
