import { cn } from "@/lib/cn";
import {
  isActiveStage,
  TASK_STAGES,
  taskStage,
  type CombinedTask,
  type TaskStage,
  type TaskStageFilter,
} from "@/lib/combinedTasks";

interface TaskStagePillsProps {
  tasks: CombinedTask[];
  activeFilter: TaskStageFilter;
  onChange: (filter: TaskStageFilter) => void;
}

/**
 * Status pills for the Operations list's "All tasks" scope. Engineering and
 * Operations name their statuses differently, so these count the shared
 * STAGES (`taskStage` in lib/combinedTasks.ts) — each row still shows its own
 * list's real status. Same look and toggle behaviour as OperationsStatusPills.
 */
export function TaskStagePills({ tasks, activeFilter, onChange }: TaskStagePillsProps) {
  const countByStage: Record<TaskStage, number> = {
    "Not started": 0,
    "In progress": 0,
    "On hold": 0,
    Complete: 0,
    Canceled: 0,
  };
  for (const t of tasks) countByStage[taskStage(t)]++;
  const activeCount = TASK_STAGES.filter(isActiveStage).reduce((n, s) => n + countByStage[s], 0);

  return (
    <div className="flex flex-wrap gap-2">
      <Pill
        label="Active"
        count={activeCount}
        active={activeFilter === "ACTIVE"}
        onClick={() => onChange(activeFilter === "ACTIVE" ? null : "ACTIVE")}
        emphasized
      />
      {TASK_STAGES.map((stage) => (
        <Pill
          key={stage}
          label={stage}
          count={countByStage[stage]}
          active={activeFilter === stage}
          onClick={() => onChange(activeFilter === stage ? null : stage)}
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
      aria-pressed={active}
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
