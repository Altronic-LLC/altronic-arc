import { NavLink } from "react-router-dom";
import { Factory, Settings } from "lucide-react";
import { MCNS_CONFIGURED } from "@/api/config";
import { MCN_PRIORITY_MEANINGS, type McnPriority, type McnStatus } from "@/types/mcn";
import { useMyMcnAccess } from "@/hooks/useMcnRoles";
import { LoadingTasks } from "./LoadingTasks";
import { cn } from "@/lib/cn";

// =============================================================================
// MCN atoms — status and priority chips, the section's sub-nav, and the gate
// every MCN screen sits behind (configured? in pilot?). Operations' own atoms.
// =============================================================================

const CHIP = "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium";

const STATUS_TONE: Record<McnStatus, string> = {
  Draft: "border-dashed border-fg-muted/60 bg-surface text-fg",
  Submitted: "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg",
  Approved: "border-superior-blue/40 bg-superior-blue/10 text-superior-blue",
  Implemented: "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
  Rejected: "border-border bg-surface-2 text-fg-muted",
};

export function McnStatusChip({ status }: { status: McnStatus }) {
  return <span className={cn(CHIP, STATUS_TONE[status])}>{status}</span>;
}

/** Level 1 is the one that must stand out — it means "immediately". */
export function McnPriorityChip({ priority }: { priority: string }) {
  if (!priority) return <span className="text-xs text-fg-muted">—</span>;
  const meaning = MCN_PRIORITY_MEANINGS[priority as McnPriority];
  return (
    <span
      title={meaning}
      className={cn(
        CHIP,
        priority === "Level 1"
          ? "border-cooper-red/40 bg-cooper-red/10 text-cooper-red"
          : "border-border bg-surface-2 text-fg",
      )}
    >
      {priority}
    </span>
  );
}

/** Register / Settings — Settings only for whoever can manage it. */
export function McnNav() {
  const { rights } = useMyMcnAccess();
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      isActive ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
    );
  return (
    <nav aria-label="MCN sections" className="flex flex-wrap items-center gap-1 self-start rounded-lg bg-surface-2 p-1">
      <NavLink to="/operations/mcns" end className={tab}>
        <Factory className="h-4 w-4" />
        Register
      </NavLink>
      {rights.canManage && (
        <NavLink to="/operations/mcns/settings" className={tab}>
          <Settings className="h-4 w-4" />
          Settings
        </NavLink>
      )}
    </nav>
  );
}

/**
 * Every MCN screen sits behind this: the lists must be set up, and while MCNs
 * are in pilot only somebody holding an MCN role (or an ARC admin) gets in.
 * Everyone else is told it's coming, not that they lack access — they will
 * have it when it goes live.
 */
export function McnAccessGate({ children }: { children: React.ReactNode }) {
  const access = useMyMcnAccess();
  if (!MCNS_CONFIGURED) {
    return (
      <Notice title="Manufacturing Change Notices aren't set up yet">
        The three SharePoint lists haven't been created, or their ids aren't in ARC's settings yet. An admin runs{" "}
        <span className="font-mono text-xs">scripts/create-mcn-lists.ps1</span>, sets the ids and redeploys.
      </Notice>
    );
  }
  if (access.resolving) return <LoadingTasks noun="MCNs" />;
  if (!access.rights.canOpen) {
    return (
      <Notice title="MCNs — coming soon">
        Manufacturing Change Notices are being piloted by the Manufacturing Team. Everyone will be able to read them
        once they go live.
      </Notice>
    );
  }
  return <>{children}</>;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <Factory className="mx-auto h-8 w-8 text-fg-muted" />
        <h1 className="mt-3 font-display text-lg font-semibold text-fg">{title}</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-fg-muted">{children}</p>
      </div>
    </div>
  );
}

/** A section title on a card — the house style. */
export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">{children}</h2>
  );
}
