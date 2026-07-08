import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Eye, PenSquare, Sparkles, UserCheck } from "lucide-react";
import { useTasks } from "@/hooks/useTasks";
import { useEirs } from "@/hooks/useEirs";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadingTasks } from "@/components/LoadingTasks";
import { eirStatusColor, statusColor } from "@/components/atoms";
import type { Eir, Person, Task } from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// User Dashboard — the landing page after sign-in. Personalised to the signed-
// in user: the items they're Assigned to, Watching, and Created/Reported —
// across BOTH tasks and EIRs — plus a "Recently updated" feed of everything
// they're involved in. A compact stat row summarises the counts.
//
// Completed tasks / closed EIRs are hidden by default; the "Show completed"
// toggle reveals them. Everything is derived from the tasks + EIRs already in
// the React Query cache, so the dashboard stays in sync with the rest of the
// app for free.
// =============================================================================

/** Normalised row shape so tasks and EIRs render side by side in one list. */
interface DashItem {
  key: string;
  kind: "task" | "eir";
  id: number;
  title: string;
  status: string;
  colorClass: string;
  modifiedAt: Date;
  open: boolean;
}

function matches(list: Person[], email: string): boolean {
  if (!email) return false;
  return list.some((p) => (p.email ?? "").toLowerCase() === email);
}

function taskToItem(t: Task): DashItem {
  return {
    key: `task-${t.id}`,
    kind: "task",
    id: t.id,
    title: t.numberedTitle || t.title,
    status: t.status,
    colorClass: statusColor(t.status),
    modifiedAt: t.modifiedAt,
    open: t.status !== "Complete",
  };
}

function eirToItem(e: Eir): DashItem {
  return {
    key: `eir-${e.id}`,
    kind: "eir",
    id: e.id,
    title: [e.eirNo, e.title].filter(Boolean).join(" — ") || e.title,
    status: e.status,
    colorClass: eirStatusColor(e.status),
    modifiedAt: e.modifiedAt,
    open: e.status !== "Closed",
  };
}

/** Filter by open/closed (unless showing completed) and sort newest-first. */
function prep(items: DashItem[], showCompleted: boolean): DashItem[] {
  const filtered = showCompleted ? items : items.filter((i) => i.open);
  return [...filtered].sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

export function DashboardView() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: eirs = [] } = useEirs();
  const currentUser = useCurrentUser();
  const [showCompleted, setShowCompleted] = useState(false);

  const myEmail = (currentUser.email ?? "").toLowerCase();

  const buckets = useMemo(() => {
    const assignedRaw = [
      ...tasks.filter((t) => matches(t.assigned, myEmail)).map(taskToItem),
      ...eirs.filter((e) => matches(e.assignedEngineers, myEmail)).map(eirToItem),
    ];
    const watchingRaw = [
      ...tasks.filter((t) => matches(t.watchers, myEmail)).map(taskToItem),
      ...eirs.filter((e) => matches(e.watchers, myEmail)).map(eirToItem),
    ];
    const createdRaw = [
      ...tasks
        .filter((t) => (t.author?.email ?? "").toLowerCase() === myEmail)
        .map(taskToItem),
      ...eirs
        .filter(
          (e) =>
            (e.author?.email ?? "").toLowerCase() === myEmail ||
            (e.reporter?.email ?? "").toLowerCase() === myEmail,
        )
        .map(eirToItem),
    ];

    // "Recently updated" = anything I'm involved in, deduped by key.
    const involved = new Map<string, DashItem>();
    for (const i of [...assignedRaw, ...watchingRaw, ...createdRaw]) {
      if (!involved.has(i.key)) involved.set(i.key, i);
    }

    return {
      assigned: prep(assignedRaw, showCompleted),
      watching: prep(watchingRaw, showCompleted),
      created: prep(createdRaw, showCompleted),
      recent: prep([...involved.values()], showCompleted).slice(0, 10),
    };
  }, [tasks, eirs, myEmail, showCompleted]);

  if (isLoading) return <LoadingTasks noun="your dashboard" />;

  const nothingYet =
    buckets.assigned.length === 0 &&
    buckets.watching.length === 0 &&
    buckets.created.length === 0;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg sm:text-2xl">
            <Sparkles className="h-5 w-5 text-accent" />
            My Dashboard
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {greet(currentUser.displayName)} — here's everything you're involved in.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 self-start rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Show completed
        </label>
      </header>

      {/* Compact stat row */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Assigned" value={buckets.assigned.length} icon={<UserCheck className="h-4 w-4" />} />
        <StatTile label="Watching" value={buckets.watching.length} icon={<Eye className="h-4 w-4" />} />
        <StatTile label="Created" value={buckets.created.length} icon={<PenSquare className="h-4 w-4" />} />
      </div>

      {nothingYet && !showCompleted && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-fg-muted">
          Nothing active right now. Items you're assigned to, watching, or created
          will show up here. Try <strong>Show completed</strong> to see finished work.
        </div>
      )}

      <DashSection
        title="Assigned to me"
        icon={<UserCheck className="h-4 w-4" />}
        items={buckets.assigned}
        emptyText="Nothing is assigned to you."
      />
      <DashSection
        title="Watching"
        icon={<Eye className="h-4 w-4" />}
        items={buckets.watching}
        emptyText="You're not watching anything."
      />
      <DashSection
        title="Created / reported by me"
        icon={<PenSquare className="h-4 w-4" />}
        items={buckets.created}
        emptyText="You haven't created or reported anything."
      />
      <DashSection
        title="Recently updated"
        icon={<Clock className="h-4 w-4" />}
        items={buckets.recent}
        emptyText="No recent activity on your items."
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        <span className="text-accent">{icon}</span>
        {label}
      </div>
      <div className="font-display text-3xl font-bold tabular-nums text-fg">{value}</div>
    </div>
  );
}

function DashSection({
  title,
  icon,
  items,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  items: DashItem[];
  emptyText: string;
}) {
  const navigate = useNavigate();
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
        <span className="text-fg-muted">{icon}</span>
        {title}
        <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-fg-muted">
          {items.length}
        </span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={() =>
                navigate(item.kind === "eir" ? `/eir/${item.id}` : `/task/${item.id}`)
              }
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-fg-muted hover:bg-surface-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <TypeBadge kind={item.kind} />
                <span className="truncate font-medium text-fg">{item.title}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  item.colorClass,
                )}
              >
                {item.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function TypeBadge({ kind }: { kind: "task" | "eir" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
        kind === "eir"
          ? "bg-cooper-red/10 text-cooper-red"
          : "bg-accent/10 text-accent",
      )}
    >
      {kind === "eir" ? "EIR" : "Task"}
    </span>
  );
}

function greet(name: string): string {
  if (!name) return "Welcome back";
  const first = name.split(" ")[0];
  const hr = new Date().getHours();
  const slot = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  return `${slot}, ${first}`;
}
