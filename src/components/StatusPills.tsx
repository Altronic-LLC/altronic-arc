import { cn } from "@/lib/cn";
import { STATUSES, type Status, type Task } from "@/types/task";

interface StatusPillsProps {
  tasks: Task[];
  activeFilter: Status | "ALL_ACTIVE" | null;
  onChange: (filter: Status | "ALL_ACTIVE" | null) => void;
}

/** "Active" = anything not Complete. Mirrors the existing app's grouping. */
function isActive(t: Task): boolean {
  return t.status !== "Complete";
}

export function StatusPills({ tasks, activeFilter, onChange }: StatusPillsProps) {
  const activeCount = tasks.filter(isActive).length;
  const countByStatus: Record<Status, number> = {
    BACKLOG: 0,
    "SELECTED FOR DEVELOPMENT": 0,
    "In Progress": 0,
    "On Hold": 0,
    Blocked: 0,
    Complete: 0,
  };
  for (const t of tasks) countByStatus[t.status]++;

  return (
    <div className="flex flex-wrap gap-2">
      <Pill
        label="Active"
        count={activeCount}
        active={activeFilter === "ALL_ACTIVE"}
        onClick={() => onChange(activeFilter === "ALL_ACTIVE" ? null : "ALL_ACTIVE")}
        emphasized
      />
      {STATUSES.map((status) => (
        <Pill
          key={status}
          label={status}
          count={countByStatus[status]}
          active={activeFilter === status}
          onClick={() => onChange(activeFilter === status ? null : status)}
        />
      ))}
    </div>
  );
}

interface PillProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  emphasized?: boolean;
}

function Pill({ label, count, active, onClick, emphasized }: PillProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all",
        active
          ? "border-accent bg-accent text-white shadow-sm"
          : "border-border bg-surface text-fg-muted hover:border-fg-muted hover:text-fg",
        emphasized && !active && "border-accent/40 text-fg",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
          active ? "bg-white/20 text-white" : "bg-surface-2 text-fg",
        )}
      >
        {count}
      </span>
    </button>
  );
}
